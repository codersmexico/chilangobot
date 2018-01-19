const { invert, merge, map } = require('lodash');

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

function monitor_channel(robot, bot_id, channels, config) {
  robot.adapter.client.on('raw_message', raw_message => {
    const message = JSON.parse(raw_message);

    if (message.type === 'pong') {
      return;
    }

    // Ignore own events
    if (message.user === bot_id) {
      return;
    }

    // { name: text, ... } => [ name, name, ... ]
    const monitored_channel_names = Object.keys(config.monitored_channels);

    // { id: name, ... } => { name: id, ... }
    const all_channels_with_id_by_name = invert(channels);

    // [ name, name, ... ] => [ id, id, ... ]
    const monitored_channel_ids = monitored_channel_names.map(name => all_channels_with_id_by_name[name]);

    // console.log(JSON.stringify(message, null, 2));

    robot.logger.debug(`*** Got ${message.type} ${message.subtype}`);

    // If event is not from a monitored channel, then drop the event
    if (monitored_channel_ids.indexOf(message.channel) === -1) {
      robot.logger.debug(`*** channel ${message.channel} is not monitored, dropping event`);
      return;
    }

    const event_channel = channels[message.channel];
    const monitored_events = config.monitored_channels[event_channel];
    const monitored_event_types = map(monitored_events, 'type');

    robot.logger.debug(`*** monitored events: ${monitored_event_types}`);

    // If event is not in the monitored events list, drop the event
    if (monitored_event_types.indexOf(message.type) === -1) {
      robot.logger.debug(`*** event ${message.type} is not monitored, dropping event`);
      return;
    }

    monitored_events.forEach(monitored_event => {
      const event_type = `${message.type}${message.subtype ? `.${message.subtype}` : ''}`;
      const monitored_event_type = `${monitored_event.type}${
        monitored_event.subtype ? `.${monitored_event.subtype}` : ''
      }`;

      robot.logger.debug(`*** event_type: ${event_type}; monitored_event_type: ${monitored_event_type}`);

      if (event_type !== monitored_event_type) {
        return;
      }

      robot.adapter.client.web.users.info(message.user).then(response => {
        // Skip message if channel monitoring is marked as admins_only and user is neither admin nor owner.
        if (monitored_event.admins_only && !response.user.is_admin && !response.user.is_owner) {
          return;
        }

        // Skip message if channel monitoring is marked as users_only and user is either an admin or owner.
        if (monitored_event.users_only && (response.user.is_admin || response.user.is_owner)) {
          return;
        }

        if (monitored_event.target === 'dm') {
          send_private_message(robot, message.user, monitored_event.text);
        } else if (monitored_event.target === 'channel') {
          send_message(robot, message.channel, monitored_event.text);
        } else {
          robot.logger.error('Unknown or missing target for monitored_event');
        }
      });
    });
  });
}

function send_message(robot, channel, message) {
  robot.logger.info(`Sending message "${message}" to channel "${channel}"`);
  const options = {
    as_user: true,
    unfurl_links: false,
    link_names: true,
  };

  robot.adapter.client.web.chat.postMessage(channel, message, options);
}

function send_private_message(robot, user, message) {
  robot.adapter.client.web.im.open(user).then(
    response => {
      const options = {
        as_user: true,
        unfurl_links: false,
        link_names: true,
      };

      robot.logger.info(`Sending message "${message}" to user "${response.channel.id}"`);
      robot.adapter.client.web.chat.postMessage(response.channel.id, message, options);
    },
    error => {
      robot.logger.error(error);
    }
  );
}

module.exports = robot => {
  robot.adapter.client.web.auth.test().then(self => {
    get_slack_channels(robot).then(channels => monitor_channel(robot, self.user_id, channels, config));
  });
};
