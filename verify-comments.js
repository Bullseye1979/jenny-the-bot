import { readFileSync } from 'fs';

const BASE = 'W:/home/discordbot/jenny-the-bot/development/modules/';
const files = [
  '00005-discord-status-prepare.js',
  '00010-core-channel-config.js',
  '00020-discord-channel-gate.js',
  '00021-api-token-gate.js',
  '00022-discord-gdpr-gate.js',
  '00025-discord-admin-gdpr.js',
  '00030-discord-voice-transcribe.js',
  '00032-discord-add-files.js',
  '00035-bard-admin-join.js',
  '00036-bard-cron.js',
  '00040-discord-admin-join.js',
  '00041-webpage-auth.js',
  '00043-webpage-menu.js',
];

let allOk = true;

for (const f of files) {
  const content = readFileSync(BASE + f, 'utf8').replace(/\r\n/g, '\n');
  const lines = content.split('\n');
  const errors = [];

  // Find where header ends (the empty line after opening block)
  let headerEndLine = -1;
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    if (lines[i] === '') { headerEndLine = i; break; }
  }

  // Check all header comment lines (lines 0 to headerEndLine-1 and headerEndLine+1 to headerEndLine+3)
  const commentLines = [];
  for (let i = 0; i < headerEndLine; i++) commentLines.push(i);
  for (let i = headerEndLine + 1; i < headerEndLine + 4; i++) commentLines.push(i);

  for (const i of commentLines) {
    const line = lines[i];
    if (!line) continue;
    if (line.length !== 84 && line.length !== 85 && line.length !== 86) {
      errors.push('HEADER L' + i + ' len=' + line.length + ': ' + line.slice(0, 70));
    }
    // Check that no " */ line ending is used (should end with * not */)
    if (line.startsWith('/* ') && line.endsWith('*/')) {
      errors.push('HEADER L' + i + ' ends with */ instead of *: ' + line.slice(0, 60));
    }
  }

  // Check: filename line has no quotes
  const filenameLine = lines[1];
  if (filenameLine && filenameLine.includes('"')) {
    errors.push('FILENAME has quotes: ' + filenameLine.trim());
  }

  // Check: Version 1.0
  const versionLine = lines[2];
  if (versionLine && !versionLine.includes('Version 1.0')) {
    errors.push('VERSION wrong: ' + versionLine.trim());
  }

  // Check function sig blocks in code
  // Find all /****/ border lines in code (after header)
  let codeStart = headerEndLine + 4;
  for (let i = codeStart; i < lines.length - 2; i++) {
    const line = lines[i];
    if (line.length !== 86) continue; // not a border line
    if (!line.startsWith('/') || !line.endsWith('/')) continue;
    if (!line.slice(1, -1).split('').every(c => c === '*')) continue;
    // This is a border line — check the block
    const next1 = lines[i + 1];
    const next2 = lines[i + 2];
    const next3 = lines[i + 3];
    if (next1 && next1.startsWith('/* functionSignature:')) {
      // Check all lines in the block have correct length
      if (next1.length !== 84) errors.push('FUNCSIG L' + (i+1) + ' len=' + next1.length + ': ' + next1.slice(0, 70));
      if (next2 && next2.startsWith('/* ') && next2.length !== 84) {
        errors.push('FUNCSIG L' + (i+2) + ' len=' + next2.length + ': ' + next2.slice(0, 70));
      }
    }
  }

  // Check no inline trailing // comments in code lines
  for (let i = codeStart; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trimStart();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    // Check for ' // ' pattern that indicates trailing comment
    // But avoid false positives in strings like URL strings
    // Simple check: if line has ' // ' and doesn't look like a URL
    const idx = line.indexOf(' // ');
    if (idx > 0) {
      // Check if it's inside a string by looking at quote balance before idx
      let inStr = false, strCh = '';
      for (let j = 0; j < idx; j++) {
        const c = line[j];
        if (!inStr && (c === '"' || c === "'" || c === '`')) { inStr = true; strCh = c; }
        else if (inStr) {
          if (c === '\\') { j++; continue; }
          if (c === strCh) inStr = false;
        }
      }
      if (!inStr) {
        errors.push('INLINE COMMENT L' + i + ': ' + line.trim().slice(0, 70));
      }
    }
  }

  if (errors.length) {
    console.log('\nISSUES in ' + f + ':');
    errors.forEach(e => console.log('  ' + e));
    allOk = false;
  } else {
    console.log('OK: ' + f);
  }
}

if (allOk) console.log('\nAll 13 files verified successfully.');
else console.log('\nSome files have issues (see above).');
