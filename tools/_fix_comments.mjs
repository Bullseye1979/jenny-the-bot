import { readFileSync, writeFileSync } from 'fs';

const BORDER = '/' + '*'.repeat(82) + '/';
const LINE_LEN = 84;

function contentLine(text) {
  const inner = LINE_LEN - 3 - 2; // 79
  const padded = text.padEnd(inner, ' ');
  return '/* ' + padded + ' *';
}

function emptyContent() {
  return '/* ' + ' '.repeat(LINE_LEN - 5) + ' *';
}

// Reformat a comment block given its raw content lines (without border)
function makeBlock(contentLines) {
  return [BORDER, ...contentLines.map(contentLine), BORDER].join('\n');
}

function makeSeparatorBlock() {
  return [BORDER, emptyContent(), BORDER].join('\n');
}

// Extract text from a comment line (removes /* ... * decoration)
function extractText(line) {
  let t = line.trim();
  // Remove trailing */ or *
  if (t.endsWith('*/')) t = t.slice(0, -2).trimEnd();
  if (t.endsWith(' *')) t = t.slice(0, -2).trimEnd();
  if (t.endsWith('*')) t = t.slice(0, -1).trimEnd();
  // Remove leading /* or *
  if (t.startsWith('/*')) t = t.slice(2).trimStart();
  else if (t.startsWith('*')) t = t.slice(1).trimStart();
  return t;
}

// Process a single file
function processFile(filepath) {
  const original = readFileSync(filepath, 'utf8');
  const lines = original.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, '');
    const trimmed = line.trim();

    // Detect start of a comment block (line starting with /*)
    if (trimmed.startsWith('/*') && !trimmed.startsWith('//')) {
      // Collect the full comment block
      const blockLines = [];
      let j = i;

      // Single-line comment (opens and closes on same line)
      if ((trimmed.startsWith('/*') && trimmed.endsWith('*/') && trimmed.length > 4)) {
        // Could be a border line like /****/ or a single-line comment
        if (/^\/\*+\/$/.test(trimmed)) {
          // It's a border line - could be standalone or part of a block
          // Check if next lines continue a block
          if (j + 1 < lines.length) {
            const nextTrim = lines[j + 1].replace(/\r$/, '').trim();
            if (nextTrim.startsWith('/*') || nextTrim.startsWith('*')) {
              // Start of a block comment
              blockLines.push(trimmed);
              j++;
              while (j < lines.length) {
                const bl = lines[j].replace(/\r$/, '').trim();
                blockLines.push(bl);
                j++;
                if (/^\/\*+\/$/.test(bl) || bl.endsWith('*/')) break;
              }
              // Process block
              out.push(reformatCommentBlock(blockLines));
              i = j;
              continue;
            }
          }
          // Standalone border - convert to separator
          out.push(makeSeparatorBlock());
          i++;
          continue;
        }
        // Regular single-line block comment - leave as-is (inside code)
        out.push(line);
        i++;
        continue;
      }

      // Multi-line comment block
      blockLines.push(trimmed);
      j++;
      while (j < lines.length) {
        const bl = lines[j].replace(/\r$/, '').trim();
        blockLines.push(bl);
        j++;
        // End of block: line ending with */ or a border line
        if (/^\/\*+\/$/.test(bl) || (bl.endsWith('*/') && bl.length > 2)) break;
      }
      out.push(reformatCommentBlock(blockLines));
      i = j;
      continue;
    }

    // Non-comment line: remove inline trailing comments on CODE lines
    // (only remove if it's actual code, not string content)
    const cleaned = removeInlineTrailingComment(line);
    out.push(cleaned);
    i++;
  }

  return out.join('\n');
}

function reformatCommentBlock(blockLines) {
  // Classify block type
  const contentLines = [];
  for (const line of blockLines) {
    const t = line.trim();
    // Skip border lines
    if (/^\/\*+\/$/.test(t)) continue;
    // Skip empty lines inside block
    if (t === '' || t === '*' || /^\*+$/.test(t)) continue;
    const text = extractText(t);
    if (text) contentLines.push(text);
  }

  if (contentLines.length === 0) {
    return makeSeparatorBlock();
  }

  return makeBlock(contentLines);
}

// Remove inline trailing comments from code lines
// e.g. "return x; // done" -> "return x;"
// Be careful not to remove // inside strings
function removeInlineTrailingComment(line) {
  // Simple heuristic: find // that's not inside a string
  // This is a basic implementation
  let inStr = false;
  let strChar = '';
  let inTemplate = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const prev = i > 0 ? line[i-1] : '';

    if (inStr) {
      if (c === strChar && prev !== '\\') inStr = false;
      continue;
    }

    if (c === '"' || c === "'") {
      inStr = true;
      strChar = c;
      continue;
    }

    if (c === '/' && i + 1 < line.length && line[i+1] === '/') {
      // Found // - remove it and everything after
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

// Verify line lengths
function verifyFile(filepath, content) {
  const lines = content.split('\n');
  const issues = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if ((l.startsWith('/*') || l.startsWith('/* ')) && l.trim().startsWith('/*')) {
      if (l.length !== LINE_LEN) {
        issues.push(`Line ${i+1}: expected ${LINE_LEN}, got ${l.length}: ${JSON.stringify(l)}`);
      }
    }
  }
  if (issues.length > 0) {
    console.log('ISSUES in', filepath, ':');
    issues.slice(0, 5).forEach(x => console.log('  ', x));
  }
}

const files = [
  'W:/home/discordbot/jenny-the-bot/development/tools/getAnimatedPicture.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getBan.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getConfluence.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getGoogle.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getHistory.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getImage.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getImageDescription.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getImageSD.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getInformation.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getJira.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getLocation.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getPDF.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getText.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getTime.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getTimeline.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getToken.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getVideoFromText.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getWebpage.js',
  'W:/home/discordbot/jenny-the-bot/development/tools/getYoutube.js',
  'W:/home/discordbot/jenny-the-bot/development/shared/webpage/interface.js',
];

for (const f of files) {
  try {
    const result = processFile(f);
    verifyFile(f, result);
    writeFileSync(f, result, 'utf8');
    console.log('Done:', f.split('/').pop());
  } catch(e) {
    console.error('ERROR', f, e.message);
  }
}
