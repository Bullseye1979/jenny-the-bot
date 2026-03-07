import { readFileSync, writeFileSync } from 'fs';

const B = '/' + '*'.repeat(82) + '/';
const INNER = 79;

function cl(text) {
  return '/* ' + String(text).padEnd(INNER, ' ') + ' *';
}

function blkLines(lines) {
  return B + '\n' + lines.map(cl).join('\n') + '\n' + B;
}

function sep() {
  return B + '\n' + cl('') + '\n' + B;
}

function wrap(text, indent = '         ') {
  if (text.length <= INNER) return [text];
  const words = text.split(' ');
  const result = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; }
    else if ((cur + ' ' + w).length <= INNER) { cur += ' ' + w; }
    else { result.push(cur); cur = indent + w; }
  }
  if (cur) result.push(cur);
  return result;
}

function blkWrap(...texts) {
  const lines = [];
  for (const t of texts) lines.push(...wrap(t));
  return blkLines(lines);
}

// For interface.js: blocks use /* prefix for opening and * prefix for content lines
// Opening: /****...*  (starts with /*, many stars, no closing /)
// Content: * text
// Closing: *****/   (many stars followed by */)

function isInterfaceBlockOpener(line) {
  const t = line.trim();
  // Starts with /* followed by 5+ stars, NOT ending with /
  return /^\/\*{5,}$/.test(t) || /^\/\*{5,}[^/]\s*$/.test(t);
}

function isInterfaceBlockCloser(line) {
  const t = line.trim();
  // Starts with 5+ stars and ends with /
  return /^\*{5,}\/$/.test(t) || /^\/\*{5,}\/$/.test(t);
}

function isInterfaceContentLine(line) {
  const t = line.trim();
  return t.startsWith('* ') || t.startsWith('/* ') || t.startsWith('/**');
}

function extractInterfaceText(line) {
  let t = line.trim();
  t = t.replace(/\s*\*\/\s*$/, '').trimEnd();
  t = t.replace(/\s*\*\s*$/, '').trimEnd();
  if (t.startsWith('/**')) t = t.slice(3).trimStart();
  else if (t.startsWith('/*')) t = t.slice(2).trimStart();
  else if (t.startsWith('* ')) t = t.slice(2).trimStart();
  else if (t.startsWith('*')) t = t.slice(1).trimStart();
  return t || null;
}

function reformatInterfaceSource(src) {
  const lines = src.split('\n').map(l => l.replace(/\r$/, ''));
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    // Check for a comment block (any of the opening patterns)
    const isOpener = /^\/\*{5,}\/?$/.test(t);

    if (isOpener) {
      // Check if it's a complete single-line block (border) ending with /
      const isSingleLineBorder = /^\/\*{5,}\/$/.test(t);

      if (isSingleLineBorder) {
        // Could be start of a new-style block or a standalone border
        // Look ahead to see if next lines look like comment content
        const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
        const isNextContent = nextLine.startsWith('/* ') || nextLine.startsWith('* ');

        if (isNextContent) {
          // Start of a new-style block
          const blockLines = [line];
          let j = i + 1;
          while (j < lines.length) {
            const bl = lines[j];
            const bt = bl.trim();
            blockLines.push(bl);
            j++;
            if (/^\/\*{5,}\/$/.test(bt) || /^\*{5,}\/$/.test(bt)) break;
            if (j - i > 15) break; // safety
          }
          out.push(...reformatBlock(blockLines));
          i = j;
          continue;
        } else {
          // Standalone border - make it a separator block
          out.push(...sep().split('\n'));
          i++;
          continue;
        }
      } else {
        // Old-style opener (no closing /)
        // Collect until we find a closing line
        const blockLines = [line];
        let j = i + 1;
        while (j < lines.length) {
          const bl = lines[j];
          const bt = bl.trim();
          blockLines.push(bl);
          j++;
          // Old-style closer: many stars ending with /
          if (/^\*{5,}\/$/.test(bt) || /^\/\*{5,}\/$/.test(bt)) break;
          if (j - i > 15) break;
        }
        out.push(...reformatBlock(blockLines));
        i = j;
        continue;
      }
    }

    // Skip the /** inline comment (like /** Lazily-created... */)
    if (/^\/\*\*[^*]/.test(t) && t.endsWith('*/')) {
      // Inline doc comment - skip it entirely (remove it)
      i++;
      continue;
    }

    // Strip inline trailing // comments from code lines
    out.push(stripInlineComment(line));
    i++;
  }

  return out.join('\n');
}

function reformatBlock(blockLines) {
  const contentTexts = [];
  for (const bl of blockLines) {
    const bt = bl.trim();
    // Skip border lines
    if (/^\/\*{5,}\/?$/.test(bt) || /^\*{5,}\/$/.test(bt)) continue;
    if (bt === '') continue;
    const text = extractInterfaceText(bt);
    if (text && !/^\*+$/.test(text)) contentTexts.push(text);
  }

  if (contentTexts.length === 0) {
    return sep().split('\n');
  }

  const result = [B];
  for (const t of contentTexts) {
    wrap(t).forEach(l => result.push(cl(l)));
  }
  result.push(B);
  return result;
}

function stripInlineComment(line) {
  let inDouble = false, inSingle = false, inTemplate = false;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i-1] : '\0';
    if (ch === '\\' && (inDouble || inSingle || inTemplate)) { i++; continue; }
    if (!inDouble && !inSingle && !inTemplate) {
      if (ch === '"') { inDouble = true; continue; }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === '`') { inTemplate = true; continue; }
    }
    if (inDouble && ch === '"' && prev !== '\\') { inDouble = false; continue; }
    if (inSingle && ch === "'" && prev !== '\\') { inSingle = false; continue; }
    if (inTemplate && ch === '`' && prev !== '\\') { inTemplate = false; continue; }
    if (!inDouble && !inSingle && !inTemplate && ch === '/' && line[i+1] === '/') {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function check(src) {
  const lines = src.split('\n');
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (l.startsWith('/*')) {
      if (l.length !== 84) bad.push(`L${i+1}(${l.length}): ${l.slice(0,50)}`);
    }
  }
  if (bad.length) {
    bad.forEach(b => console.log('  WARN ' + b));
  } else {
    console.log('  OK');
  }
}

const filepath = 'W:/home/discordbot/jenny-the-bot/development/shared/webpage/interface.js';
let src = readFileSync(filepath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

src = reformatInterfaceSource(src);

// Prepend file header
const header = blkWrap(
  'filename: interface.js',
  'Version 1.0',
  'Purpose: Shared webpage utilities and menu renderer.'
);

// Replace the first block (file header) if it exists, else prepend
const firstBorderIdx = src.indexOf(B);
if (firstBorderIdx >= 0) {
  const secondBorderIdx = src.indexOf(B, firstBorderIdx + B.length);
  const thirdBorderIdx = secondBorderIdx >= 0 ? src.indexOf(B, secondBorderIdx + B.length) : -1;
  const fourthBorderIdx = thirdBorderIdx >= 0 ? src.indexOf(B, thirdBorderIdx + B.length) : -1;

  if (fourthBorderIdx >= 0) {
    const restStart = fourthBorderIdx + B.length;
    src = header + '\n\n' + sep() + src.slice(restStart);
  } else if (secondBorderIdx >= 0) {
    const restStart = secondBorderIdx + B.length;
    src = header + '\n\n' + sep() + src.slice(restStart);
  }
}

writeFileSync(filepath, src, 'utf8');
console.log('interface.js:');
check(src);

// Print first 30 lines to verify
const lines = src.split('\n');
console.log('\nFirst 30 lines:');
lines.slice(0, 30).forEach((l, i) => console.log(String(i+1).padStart(3), l.length, l.slice(0, 80)));
