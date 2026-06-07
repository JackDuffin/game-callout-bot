require('dotenv').config();
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs = require('fs');

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

const isDev = process.env.NODE_ENV === 'development';

(async () => {
  try {
    if (isDev) {
      const guildId = process.env.TEST_GUILD_ID;
      if (!guildId) {
        console.error('❌ Missing TEST_GUILD_ID in .env');
        process.exit(1);
      }
      console.log('Registering slash commands to TEST server...');
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log('✅ Slash commands registered to TEST server!');
    } else {
      console.log('Registering slash commands globally...');
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log('✅ Global slash commands registered! Note: Discord may take up to 1 hour to propagate.');
    }
  } catch (error) {
    console.error(error);
  }
})();