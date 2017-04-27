// Libraries.
const mysql = require('mysql');
const process = require('process');
const { get, merge } = require('lodash');

// Import default and per-environment configurations.
const nodeEnv = get(process, 'env.NODE_ENV');
const defaultConfig = require('./.stalkerrc');
const envConfigPath = `./.stalkerrc-${nodeEnv}`;
let envConfig;
let config;

// Merge configurations into a single one.
try {
  envConfig = require(envConfigPath);
} catch (e) {
  envConfig = {};
} finally {
  config = merge({}, defaultConfig, envConfig);
}

// Global connection instance, might be a good idea to refactor.
const connection = mysql.createConnection(get(config, 'mysql'));
// For some reason, connection resets at 00:00, so reconnect in case of lost connection.
connection.on('error', function(err) {
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    connectToDB(connection);
  } else {
    throw err;
  }
});

// Connect to DB, return a promise
function connectToDB(connection) {
  return new Promise((resolve, reject) => {
    connection.connect(err => {
      if (err) {
        reject(err);
      } else {
        resolve(resolve);
      }
    });
  });
}

// List Slack channels. Might need to reload to get new channels from time to time.
function getSlackChannels(client) {
  return client.web.channels.list().then(res => {
    return get(res, 'channels', []).reduce((hash, channel) => {
      hash[channel.id] = channel.name;
      return hash;
    }, {});
  });
}

module.exports = robot => {
  const all = [ connectToDB(connection), getSlackChannels(robot.adapter.client) ];

  Promise.all(all).then(results => {
    const [ , channels ] = results;

    // Listen to all channel messages and log them.
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

      // Format query by escaping fields and values.
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

      // Insert into MySQL.
      connection.query(sql);
    });
  });
};
