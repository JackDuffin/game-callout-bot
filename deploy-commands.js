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
const guildId = isDev ? process.env.TEST_GUILD_ID : process.env.GUILD_ID;

if (!guildId) {
  console.error(`❌ Missing ${isDev ? 'TEST_GUILD_ID' : 'GUILD_ID'} in .env`);
  process.exit(1);
}

console.log(`Registering slash commands to ${isDev ? 'TEST' : 'MAIN'} server...`);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
      { body: commands }
    );
    console.log(`✅ Slash commands registered to ${isDev ? 'TEST' : 'MAIN'} server!`);
  } catch (error) {
    console.error(error);
  }
})();