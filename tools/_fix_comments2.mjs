import { readFileSync, writeFileSync } from 'fs';

const BORDER = '/' + '*'.repeat(82) + '/';
const LINE_LEN = 84;

function cl(text) {
  // content line: '/* ' + text padded to 79 + ' *' = 84 chars
  const inner = 79;
  return '/* ' + text.padEnd(inner, ' ') + ' *';
}

function emptyLine() {
  return '/* ' + ' '.repeat(79) + ' *';
}

// Build a complete standardized block from content strings
function block(...lines) {
  return [BORDER, ...lines.map(cl), BORDER].join('\n');
}

function separatorBlock() {
  return [BORDER, emptyLine(), BORDER].join('\n');
}

// Verify all comment lines in a file are 84 chars
function verify(name, content) {
  const lines = content.split('\n');
  const issues = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    const t = l.trimStart();
    if (t.startsWith('/*') || t.startsWith('* ')) {
      if (l.length !== LINE_LEN && l.length > 0) {
        issues.push(`Line ${i+1} (${l.length}): ${l.slice(0,60)}`);
      }
    }
  }
  if (issues.length) {
    console.log(`ISSUES in ${name}:`);
    issues.slice(0,10).forEach(x => console.log('  ' + x));
  } else {
    console.log(`OK: ${name}`);
  }
}

// =============================================================================
// GETANIMATEDPICTURE.JS
// =============================================================================
{
  const orig = readFileSync('W:/home/discordbot/jenny-the-bot/development/tools/getAnimatedPicture.js', 'utf8');
  // We'll rebuild from scratch using the already-confirmed code logic
  // Read original and just fix comment blocks by replacing them with properly formatted ones

  let t = orig.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Replace file header
  t = t.replace(/\/\*+[\s\S]*?filename.*?getAnimatedPicture[\s\S]*?\/\*+\/\s*\n\/\*+[\s\S]*?\/\*+\//,
    block(
      'filename: getAnimatedPicture.js',
      'Version 1.0',
      'Purpose: Animate an image via Replicate (Veo) and save the video to',
      '         ./pub/documents, returning a public URL.'
    ) + '\n\n' + separatorBlock()
  );

  writeFileSync('W:/home/discordbot/jenny-the-bot/development/tools/getAnimatedPicture.js', t, 'utf8');
  console.log('Written getAnimatedPicture.js (partial - needs manual function headers)');
}
