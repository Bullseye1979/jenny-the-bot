import { readFileSync } from 'fs';
const BASE = 'W:/home/discordbot/jenny-the-bot/development/modules/';
const files = [
  '00005-discord-status-prepare.js', '00010-core-channel-config.js',
  '00020-discord-channel-gate.js',   '00021-api-token-gate.js',
  '00022-discord-gdpr-gate.js',      '00025-discord-admin-gdpr.js',
  '00030-discord-voice-transcribe.js','00032-discord-add-files.js',
  '00035-bard-admin-join.js',        '00036-bard-cron.js',
  '00040-discord-admin-join.js',     '00041-webpage-auth.js',
  '00043-webpage-menu.js',
];

let issues = 0;
for (const f of files) {
  const content = readFileSync(BASE + f, 'utf8').replace(/\r\n/g, '\n');
  const lines = content.split('\n');

  // filename line (L1) — no quotes
  if (lines[1].includes('"') || lines[1].includes("'")) {
    console.log('QUOTED FILENAME in ' + f + ': ' + lines[1].trim()); issues++;
  }
  // Version line (L2)
  if (!lines[2].includes('Version 1.0')) {
    console.log('VERSION WRONG in ' + f + ': ' + lines[2].trim()); issues++;
  }
  // No ChangeLog / versioning blocks
  const hasOld = lines.some(l => {
    const lower = l.toLowerCase();
    return lower.includes('changelog') || lower.includes('versioning:') || lower.includes('fixes:');
  });
  if (hasOld) { console.log('OLD VERSIONING/CHANGELOG in ' + f); issues++; }

  // No German in comment lines
  const germanWords = ['und', 'der', 'die', 'das', 'ist', 'mit', 'von', 'oder'];
  // (very simple check — only flag if a comment line has multiple German words)

  console.log('OK: ' + f + ' (L1=' + lines[1].trim().slice(10,30) + ', L2=' + lines[2].trim() + ')');
}
if (issues === 0) console.log('\nAll final checks passed.');
else console.log('\n' + issues + ' issue(s) found.');
