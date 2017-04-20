const mysql = require('mysql');
const process = require('process');
const { get, merge } = require('lodash');

const nodeEnv = get(process, 'env.NODE_ENV');
const defaultConfig = require('./.stalkerrc');
const envConfigPath = `./.stalkerrc-${nodeEnv}`;
let envConfig;
let config;

try {
  envConfig = require(envConfigPath);
} catch (e) {
  console.log(`Config file not found: ${envConfigPath}`);
  envConfig = {};
} finally {
  config = merge({}, defaultConfig, envConfig);
}

console.log('Configuration in use:', JSON.stringify(config, null, 2));

function connectToDB(config) {
  const connection = mysql.createConnection(config);
  return new Promise((resolve, reject) => {
    connection.connect(err => {
      if (err) {
        reject(err);
      } else {
        resolve(connection);
      }
    });
  });
}

function getSlackChannels(client) {
  return client.web.channels.list().then(res => {
    return get(res, 'channels', []).reduce((hash, channel) => {
      hash[channel.id] = channel.name;
      return hash;
    }, {});
  });
}

module.exports = robot => {
  const all = [ connectToDB(get(config, 'mysql')), getSlackChannels(robot.adapter.client) ];

  Promise.all(all).then(results => {
    const [ connection, channels ] = results;

    robot.hear(/(.*)/i, res => {
      const message = get(res, 'envelope.message');
      const id = get(message, 'id', '');
      const room_id = get(message, 'room');
      const room_name = get(channels, room_id);
      const text = get(message, 'text');
      const user_id = get(message, 'user.id');
      const user_name = get(message, 'user.name');
      const url = room_id
        ? `https://${get(config, 'slack.team')}.slack.com/archives/${room_id}/p${id.replace('.', '')}`
        : '';
      const json = JSON.stringify(message);

      let sql = 'INSERT INTO log SET ?? = ?, ?? = ?, ?? = ?, ?? = ?, ?? = ?, ?? = ?, ?? = ?, ?? = ?';
      const inserts = [
        'id',
        id,
        'room_id',
        room_id,
        'room_name',
        room_name,
        'text',
        text,
        'user_id',
        user_id,
        'user_name',
        user_name,
        'url',
        url,
        'json',
        json,
      ];
      sql = mysql.format(sql, inserts);
      connection.query(sql);
    });
  });
};
