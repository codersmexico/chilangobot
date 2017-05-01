const { invert, merge } = require('lodash');

// Import default and per-environment configurations.
const node_env = process.env.NODE_ENV;
const default_config = require('./.dmrc');
const env_config_path = `./.dmrc-${node_env}`;
let env_config;
let config;

// Merge configurations into a single one.
try {
  env_config = require(env_config_path);
} catch (e) {
  env_config = {};
} finally {
  config = merge({}, default_config, env_config);
}

function get_slack_channels(robot) {
  return robot.adapter.client.web.channels.list().then(response => {
    const channels = response.channels.reduce((hash, channel) => {
      hash[channel.id] = channel.name;
      return hash;
    }, {});

    return channels;
  });
}

function monitor_channel_joins(robot, channels, config) {
  robot.adapter.client.on('raw_message', raw_message => {
    const message = JSON.parse(raw_message);

    // { name: text, ... } => [ name, name, ... ]
    const monitored_channel_names = Object.keys(config.monitored_channels);

    // { id: name, ... } => { name: id, ... }
    const all_channels_with_id_by_name = invert(channels);

    // [ name, name, ... ] => [ id, id, ... ]
    const monitored_channel_ids = monitored_channel_names.map(name => all_channels_with_id_by_name[name]);

    // If event is not a channel join or if it is not a monitored channel, then drop the event
    if (message.type !== 'member_joined_channel' || monitored_channel_ids.indexOf(message.channel) === -1) {
      return;
    }

    // console.log(raw_message);

    robot.adapter.client.web.users.info(message.user).then(response => {
      const channel = config.monitored_channels[channels[message.channel]];

      // Skip message if channel monitoring is marked as admins_only and user is neither admin nor owner.
      // Mainly for testing purposes.
      if (channel.admins_only && (!response.user.is_admin || !response.user.is_owner)) {
        return;
      }

      send_private_message(robot, message.user, channel.text);
    });
  });
}

function send_private_message(robot, user, message) {
  robot.adapter.client.web.im.open(user).then(
    response => {
      // console.log(response);
      const options = {
        as_user: true,
        unfurl_links: true,
        link_names: true,
      };

      robot.adapter.client.web.chat.postMessage(response.channel.id, message, options);
    },
    error => {
      console.log(error);
    }
  );
}

module.exports = robot => {
  get_slack_channels(robot).then(channels => monitor_channel_joins(robot, channels, config));
};
