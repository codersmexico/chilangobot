const { invert } = require('lodash');

const monitored_channels = {
  'compra-venta': 'Bienvenidx a #compra-venta.\n\nPor favor, sigue la siguientes reglas:\n\n1. Lo que se comparte es responsabilidad de quien lo comparte y quien lo compra.\n2. Todo lo que se comparta debe seguir nuestro codigo de conducta.\n\nPara mas informacion puedes seguir este link: https://github.com/codersmexico/disclaimer-compra-venta/blob/master/readme.md',
};

const users_white_list = [ 'eruizdechavez', 'mike', 'poguez', 'diegoaguilar', 'digaresc', 'josellau', 'ratacibernetica' ];

function get_slack_channels(robot) {
  return robot.adapter.client.web.channels.list().then(response => {
    const channels = response.channels.reduce((hash, channel) => {
      hash[channel.id] = channel.name;
      return hash;
    }, {});

    return channels;
  });
}

function monitor_channel_joins(robot, channels, monitored_channels) {
  robot.adapter.client.on('raw_message', raw_message => {
    const message = JSON.parse(raw_message);

    // { name: text, ... } => [ name, name, ... ]
    const monitored_channel_names = Object.keys(monitored_channels);

    // { id: name, ... } => { name: id, ... }
    const all_channels_with_id_by_name = invert(channels);

    // [ name, name, ... ] => [ id, id, ... ]
    const monitored_channel_ids = monitored_channel_names.map(name => all_channels_with_id_by_name[name]);

    // If event is not a channel join or if it is not a monitored channel, then drop the event
    if (message.type !== 'member_joined_channel' || monitored_channel_ids.indexOf(message.channel) === -1) {
      return;
    }

    // console.log(raw_message);

    // Only send the message if the user is in the white list
    robot.adapter.client.web.users.info(message.user).then(response => {
      if (users_white_list.indexOf(response.user.name) === -1) {
        return;
      }

      send_private_message(robot, message.user, monitored_channels[channels[message.channel]]);
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
  get_slack_channels(robot).then(channels => monitor_channel_joins(robot, channels, monitored_channels));
};
