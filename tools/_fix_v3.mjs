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

// Wrap a single description string into multiple lines of max INNER chars
function wrap(text, indent = '         ') {
  if (text.length <= INNER) return [text];
  const words = text.split(' ');
  const result = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + ' ' + w).length <= INNER) {
      cur += ' ' + w;
    } else {
      result.push(cur);
      cur = indent + w;
    }
  }
  if (cur) result.push(cur);
  return result;
}

function blkWrap(...texts) {
  const lines = [];
  for (const t of texts) lines.push(...wrap(t));
  return blkLines(lines);
}

// Extract the description text from a raw comment line (strips /* and trailing * or */)
function extractText(raw) {
  let t = raw.trim();
  if (/^\/\*{2,}\/?$/.test(t)) return null; // border line
  if (t === '') return null;
  // Remove trailing */
  t = t.replace(/\s*\*\/\s*$/, '').trimEnd();
  // Remove trailing *
  t = t.replace(/\s*\*\s*$/, '').trimEnd();
  // Remove leading /**... or /*
  t = t.replace(/^\/\*+\s*/, '').trimStart();
  // Remove leading * (for lines starting with just *)
  if (t.startsWith('*')) t = t.slice(1).trimStart();
  return t || null;
}

// Is this line a "border" line? Pure /**** or /****/ pattern
function isBorderLine(raw) {
  const t = raw.trim();
  return /^\/\*{5,}\/?$/.test(t);
}

// Is this line a "content" line inside a comment block?
// Must start with /* or * and be preceded by a border
function isCommentContentLine(raw) {
  const t = raw.trim();
  return t.startsWith('/*') || (t.startsWith('*') && !t.startsWith('*/'));
}

// Reformat comment blocks in source.
// Only modifies lines that are part of pure comment blocks (bordered).
function reformatSource(src) {
  const lines = src.split('\n').map(l => l.replace(/\r$/, ''));
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check if this is a border line (comment block opener)
    if (isBorderLine(line)) {
      // Collect the whole block
      const blockLines = [line];
      let j = i + 1;

      // Keep collecting until we find the closing border
      while (j < lines.length) {
        const bl = lines[j];
        blockLines.push(bl);
        j++;
        // Stop when we hit a border line (closing border)
        if (isBorderLine(bl)) break;
        // Safety: stop after too many lines (prevent runaway)
        if (blockLines.length > 20) break;
      }

      // Verify the block ends with a border (otherwise it's malformed - keep as-is)
      const lastLine = blockLines[blockLines.length - 1];
      if (!isBorderLine(lastLine)) {
        // Malformed block - output as-is
        blockLines.forEach(l => out.push(l));
        i = j;
        continue;
      }

      // Extract content from the block (skip borders)
      const contentTexts = [];
      for (let k = 1; k < blockLines.length - 1; k++) {
        const text = extractText(blockLines[k]);
        if (text !== null) contentTexts.push(text);
      }

      if (contentTexts.length === 0) {
        // Separator block
        out.push(B);
        out.push(cl(''));
        out.push(B);
      } else {
        // Content block - wrap long lines
        out.push(B);
        for (const t of contentTexts) {
          const wrapped = wrap(t);
          wrapped.forEach(l => out.push(cl(l)));
        }
        out.push(B);
      }

      i = j;
      continue;
    }

    // Regular code line - strip inline trailing // comments
    out.push(stripInlineComment(line));
    i++;
  }

  return out.join('\n');
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

function replaceFileHeader(src, headerBlock) {
  // Find the first border in the file
  const lines = src.split('\n');
  let firstBorderEnd = -1, secondBorderEnd = -1;
  let blockCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (isBorderLine(lines[i])) {
      blockCount++;
      if (blockCount === 2) { firstBorderEnd = i; }
      if (blockCount === 4) { secondBorderEnd = i; break; }
    }
  }

  if (secondBorderEnd === -1) return headerBlock + '\n\n' + sep() + '\n\n' + src;

  const rest = lines.slice(secondBorderEnd + 1).join('\n');
  return headerBlock + '\n\n' + sep() + '\n' + rest;
}

function check(name, src) {
  const lines = src.split('\n');
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (l.startsWith('/*')) {
      if (l.length !== 84) bad.push(`L${i+1}(${l.length})`);
    }
  }
  if (bad.length) {
    console.log(`WARN ${name}: ${bad.slice(0, 5).join(' ')}`);
  } else {
    console.log(`OK:   ${name}`);
  }
}

// ─── File definitions ─────────────────────────────────────────────────────────

const HEADERS = {
  'getAnimatedPicture.js': blkWrap(
    'filename: getAnimatedPicture.js',
    'Version 1.0',
    'Purpose: Animate an image via Replicate (Veo) and save the video to',
    '         ./pub/documents, returning a public URL.'
  ),
  'getBan.js': blkWrap(
    'filename: getBan.js',
    'Version 1.0',
    'Purpose: Send a ban request to the configured admin via DM.'
  ),
  'getConfluence.js': blkWrap(
    'filename: getConfluence.js',
    'Version 1.0',
    'Purpose: Confluence Cloud proxy with v2 pages (create/append/read/list/delete/move),',
    '         Markdown to storage HTML, enforced space, and v1 attachment upload.'
  ),
  'getGoogle.js': blkWrap(
    'filename: getGoogle.js',
    'Version 1.0',
    'Purpose: Perform Google Custom Search via toolsconfig and expose results',
    '         as a function toolcall.'
  ),
  'getHistory.js': blkWrap(
    'filename: getHistory.js',
    'Version 1.0',
    'Purpose: Retrieve channel history with dump/summary/chunk modes, including',
    '         paging, filtering, and OpenAI summaries across one or many channels.'
  ),
  'getImage.js': blkWrap(
    'filename: getImage.js',
    'Version 1.0',
    'Purpose: Generate high-quality images via OpenAI API and persist them to',
    '         ./pub/documents with AI prompt enhancement and aspect handling.'
  ),
  'getImageDescription.js': blkWrap(
    'filename: getImageDescription.js',
    'Version 1.0',
    'Purpose: Vision analysis via Chat Completions using one image passed',
    '         as args.imageURL.'
  ),
  'getImageSD.js': blkWrap(
    'filename: getImageSD.js',
    'Version 1.0',
    'Purpose: Generate images via Stable Diffusion A1111 API, save to',
    '         ./pub/documents and return public links.'
  ),
  'getInformation.js': blkWrap(
    'filename: getInformation.js',
    'Version 1.0',
    'Purpose: Query channel context in MariaDB using fixed-size clusters to build',
    '         info snippets ranked by coverage then frequency.'
  ),
  'getJira.js': blkWrap(
    'filename: getJira.js',
    'Version 1.0',
    'Purpose: Jira Cloud proxy with high-level ops and normalization/repair',
    '         for requests and payloads.'
  ),
  'getLocation.js': blkWrap(
    'filename: getLocation.js',
    'Version 1.0',
    'Purpose: Generate Street View image/link, interactive pano, and Google Maps',
    '         URL with optional directions text.'
  ),
  'getPDF.js': blkWrap(
    'filename: getPDF.js',
    'Version 1.0',
    'Purpose: Toolcall-ready HTML to PDF/HTML generator that saves to',
    '         ../pub/documents, requires CSS, and uses toolsconfig.getPDF settings.'
  ),
  'getText.js': blkWrap(
    'filename: getText.js',
    'Version 1.0',
    'Purpose: Toolcall-ready saver for arbitrary plaintext into ../pub/documents',
    '         with a guessed extension.'
  ),
  'getTime.js': blkWrap(
    'filename: getTime.js',
    'Version 1.0',
    'Purpose: Return current UTC time (ISO 8601) as tool output.'
  ),
  'getTimeline.js': blkWrap(
    'filename: getTimeline.js',
    'Version 1.0',
    'Purpose: Return stored timeline periods for the current channel with',
    '         indices, timestamps, and summaries.'
  ),
  'getToken.js': blkWrap(
    'filename: getToken.js',
    'Version 1.0',
    'Purpose: Accept an image or video URL, convert videos to GIF, apply a',
    '         circular mask plus a single-color ring, and return public URLs.'
  ),
  'getVideoFromText.js': blkWrap(
    'filename: getVideoFromText.js',
    'Version 1.0',
    'Purpose: Create a short video from text via Replicate (Google Veo 3), save',
    '         it under ./pub/documents, and return a public URL.'
  ),
  'getWebpage.js': blkWrap(
    'filename: getWebpage.js',
    'Version 1.0',
    'Purpose: Fetch webpages, dump cleaned text or summarize via OpenAI if long.'
  ),
  'getYoutube.js': blkWrap(
    'filename: getYoutube.js',
    'Version 1.0',
    'Purpose: Fetch YouTube transcripts, then dump or summarize; optional search.'
  ),
  'interface.js': blkWrap(
    'filename: interface.js',
    'Version 1.0',
    'Purpose: Shared webpage utilities and menu renderer.'
  ),
};

const PATHS = {
  'getAnimatedPicture.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getAnimatedPicture.js',
  'getBan.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getBan.js',
  'getConfluence.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getConfluence.js',
  'getGoogle.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getGoogle.js',
  'getHistory.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getHistory.js',
  'getImage.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getImage.js',
  'getImageDescription.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getImageDescription.js',
  'getImageSD.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getImageSD.js',
  'getInformation.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getInformation.js',
  'getJira.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getJira.js',
  'getLocation.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getLocation.js',
  'getPDF.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getPDF.js',
  'getText.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getText.js',
  'getTime.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getTime.js',
  'getTimeline.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getTimeline.js',
  'getToken.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getToken.js',
  'getVideoFromText.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getVideoFromText.js',
  'getWebpage.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getWebpage.js',
  'getYoutube.js': 'W:/home/discordbot/jenny-the-bot/development/tools/getYoutube.js',
  'interface.js': 'W:/home/discordbot/jenny-the-bot/development/shared/webpage/interface.js',
};

for (const [name, filepath] of Object.entries(PATHS)) {
  try {
    let src = readFileSync(filepath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Reformat all comment blocks
    src = reformatSource(src);

    // Replace file header
    const header = HEADERS[name];
    if (header) {
      src = replaceFileHeader(src, header);
    }

    writeFileSync(filepath, src, 'utf8');
    check(name, src);
  } catch (e) {
    console.error(`ERROR ${name}: ${e.message}`);
  }
}
