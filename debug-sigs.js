import { readFileSync } from 'fs';
const BASE = 'W:/home/discordbot/jenny-the-bot/development/modules/';
const content = readFileSync(BASE + '00010-core-channel-config.js', 'utf8').replace(/\r\n/g, '\n');
const regex = /\/\*+\/\n\/\* functionSignature: ([^\n]+)\n(?:\/\* [^\n]*\n)+\/\*+\/\n/g;
let m;
let count = 0;
while ((m = regex.exec(content)) !== null) {
  count++;
  const sig = m[1];
  console.log('sig raw JSON:', JSON.stringify(sig));
  console.log('  trimmed:   ', JSON.stringify(sig.trim()));
}
console.log('Total:', count);
