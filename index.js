/*
 * Copyright 2021 Paul Reeve <preeve@pdjr.eu>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/

const mqtt = require('mqtt');

const Delta = require("./lib/signalk-libdelta/Delta.js");
const Log = require("./lib/signalk-liblog/Log.js");
const Schema = require("./lib/signalk-libschema/Schema.js");

const PLUGIN_ID = "mqttgw";
const PLUGIN_NAME = "MQTT gateway";
const PLUGIN_DESCRIPTION = "Exchange data with an MQTT server";

const PLUGIN_SCHEMA_FILE = __dirname + "/schema.json";
const PLUGIN_UISCHEMA_FILE = __dirname + "/uischema.json";

const PUBLICATION_RETAIN_DEFAULT = true;
const PUBLICATION_INTERVAL_DEFAULT = 60;

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;

  const log = new Log(plugin.id, { ncallback: app.setPluginStatus, ecallback: app.setPluginError });

  plugin.schema = function() {
    var schema = Schema.createSchema(PLUGIN_SCHEMA_FILE);
    return(schema.getSchema());
  };

  plugin.uiSchema = function() {
    var schema = Schema.createSchema(PLUGIN_UISCHEMA_FILE);
    return(schema.getSchema());
  }
  
  plugin.start = function(options) {
    if (options) {
      if (options.broker.url != "") {
        const client = mqtt.connect(options.broker.url, {
          rejectUnauthorized: (options.broker.rejectunauthorised)?options.broker.rejectunauthorised:true,
          reconnectPeriod: 60000,
          clientId: app.selfId,
          username: options.broker.username,
          password: options.broker.password
        });

        client.on('error', (err) => {
          log.E("connection error (%s)", err);
        });

        client.on('connect', () => {
          log.N("connected to %s (publishing %d paths; subscribing to %d topics)", options.broker.url, options.publication.paths.length, options.subscription.topics.length);
          options.subscription.topics.forEach(topic => { client.subscribe(topic.topic); });
          startSending(options.publication, client);
          unsubscribes.push(_ => client.end());
        });

        client.on('message', function(topic, message) {
          path = options.subscription.topics.reduce((a,t) => { return(((topic == t.topic) && (t.path))?t.path:a) }, (options.subscription.root + topic.replace(/\//g, "."))); 
          app.debug("received topic: %s, message: %s", path, message.toString());
          (new Delta(app,plugin.id)).addValue(path, message.toString()).commit().clear();
        });
      } else {
        log.E("configuration does not specify the MQTT server");
      }
    } else {
      log.E("bad or missing configuration file");
    }
  }

  plugin.stop = function() {
    unsubscribes.forEach(f => f());
  };

  function startSending(publicationoptions, client) {
    publicationoptions.paths.forEach(path => {
      if ((path.path) && (path.path != '')) {
        path.topic = ((path.root)?path.root:'') + ((path.topic) && (path.topic != ''))?path.topic:path.path.replace(/\./g, "/");
        path.retain = (path.retain)?path.retain:((publicationoptions.retaindefault)?publicationoptions.retaindefault:PUBLICATION_RETAIN_DEFAULT);
        path.interval = (path.interval)?path.interval:((publicationoptions.intervaldefault)?publicationoptions.intervaldefault:PUBLICATION_INTERVAL_DEFAULT);
        unsubscribes.push(app.streambundle.getSelfBus(path.path).throttle(path.interval * 1000).skipDuplicates((a,b) => (a.value == b.value)).onValue(value => {
          app.debug("publishing topic: %s, message: %s", path.topic, "" + JSON.stringify(value.value));
          client.publish(path.topic, "" + JSON.stringify(value.value), { qos: 1, retain: path.retain });
        }));
      }
    });
  }

  return plugin;

}
