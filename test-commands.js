const fs = require('fs');
const files = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of files) {
  try {
    require('./commands/' + file);
    console.log('OK:', file);
  } catch (err) {
    console.log('ERROR:', file, '-', err.message);
  }
}