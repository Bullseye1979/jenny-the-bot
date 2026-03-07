import { readFileSync, writeFileSync } from 'fs';

const B = '/' + '*'.repeat(82) + '/'; // border = 84 chars

// Content line: '/* ' + text.padEnd(79) + ' *' = 84 chars
function c(text) { return '/* ' + String(text).padEnd(79) + ' *'; }

// Empty line inside a block
function e() { return c(''); }

// Full block
function blk(...lines) { return B + '\n' + lines.map(c).join('\n') + '\n' + B; }

// Separator block (just empty content)
function sep() { return B + '\n' + e() + '\n' + B; }

// Verify
function check(name, content) {
  const lines = content.split('\n');
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (l.startsWith('/*') && l.trim() !== '') {
      if (l.length !== 84) bad.push(`L${i+1}(${l.length}): ${l.slice(0,50)}`);
    }
  }
  if (bad.length) {
    console.log(`WARN ${name}: ${bad.slice(0,5).join(' | ')}`);
  }
  return bad.length === 0;
}

// ============================================================
// Helper: replace ALL comment blocks (/* ... */) in a string
// with correctly sized ones, while preserving code.
// Strategy: find blocks by regex, then reformat each one.
// ============================================================

function reformatAllBlocks(src) {
  // Match full comment blocks: starting with /* (any amount of *) and ending with */
  // that span one or more lines.
  // We use a state machine approach.
  const lines = src.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i].replace(/\r$/, '');
    const trimmed = raw.trim();

    // Is this a comment-block opener?
    // A block opens when the line starts with /* and is a "border" or header pattern.
    // We specifically look for lines that are all /*****/ patterns (variable width).
    if (/^\/\*{2,}\/?\s*$/.test(trimmed) || /^\/\*{10,}/.test(trimmed)) {
      // This is a border line (all stars). Collect the block.
      const blockRawLines = [raw];
      let j = i + 1;

      // Collect lines until we hit the closing border
      while (j < lines.length) {
        const bl = lines[j].replace(/\r$/, '');
        const bt = bl.trim();
        blockRawLines.push(bl);
        j++;
        // Closing border: all stars ending with /
        if (/^\/\*{2,}\/$/.test(bt) || /^\*{10,}\/$/.test(bt)) break;
        // Also stop if we hit what looks like an incomplete close
        if (bt === '*/') break;
      }

      // Extract meaningful content from the block
      const contentTexts = [];
      for (let k = 0; k < blockRawLines.length; k++) {
        const bl = blockRawLines[k].trim();
        // Skip border lines
        if (/^\/\*+\/?$/.test(bl) || /^\/\*+\/\s*$/.test(bl)) continue;
        // Skip pure-star lines
        if (/^\*+\/?$/.test(bl)) continue;
        // Extract text
        let text = bl;
        // Remove leading /*
        if (text.startsWith('/**')) text = text.replace(/^\/\*+\s*/, '');
        else if (text.startsWith('/*')) text = text.slice(2).trimStart();
        else if (text.startsWith('*')) text = text.slice(1).trimStart();
        // Remove trailing */ or *
        text = text.replace(/\s*\*+\/\s*$/, '').replace(/\s*\*\s*$/, '').trimEnd();
        if (text && !/^\*+$/.test(text)) contentTexts.push(text);
      }

      if (contentTexts.length === 0) {
        out.push(sep());
      } else {
        out.push(blk(...contentTexts));
      }
      i = j;
      continue;
    }

    // Non-comment line: strip inline trailing // comments from CODE lines
    // (careful: don't strip // inside strings)
    const stripped = stripInlineComment(raw);
    out.push(stripped);
    i++;
  }

  return out.join('\n');
}

function stripInlineComment(line) {
  // Remove trailing // comment - but not if it's inside a string
  let inSingle = false, inDouble = false, inTemplate = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    const prev = i > 0 ? line[i - 1] : '\0';

    if (c === '\\' && (inSingle || inDouble)) { i++; continue; }
    if (!inSingle && !inDouble && !inTemplate && c === '"') { inDouble = true; continue; }
    if (!inSingle && !inDouble && !inTemplate && c === "'") { inSingle = true; continue; }
    if (!inSingle && !inDouble && !inTemplate && c === '`') { inTemplate = true; continue; }
    if (inDouble && c === '"') { inDouble = false; continue; }
    if (inSingle && c === "'") { inSingle = false; continue; }
    if (inTemplate && c === '`') { inTemplate = false; continue; }

    if (!inSingle && !inDouble && !inTemplate) {
      if (c === '/' && line[i + 1] === '/') {
        return line.slice(0, i).trimEnd();
      }
    }
  }
  return line;
}

// ============================================================
// Process each file with file-specific header overrides,
// then apply generic block reformatting for function headers.
// ============================================================

function processFile(filepath, fileHeader, funcBlocks) {
  let src = readFileSync(filepath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Apply specific replacements if provided
  if (funcBlocks) {
    for (const [pattern, replacement] of funcBlocks) {
      src = src.replace(pattern, replacement);
    }
  }

  // Apply generic reformatting to all remaining comment blocks
  src = reformatAllBlocks(src);

  // Fix the file header if provided (first block in file)
  if (fileHeader) {
    // The file header is now at the top - replace the first block
    const firstBlockEnd = src.indexOf(B, B.length) + B.length;
    const secondBlockEnd = src.indexOf(B, firstBlockEnd + 1) + B.length;
    // Replace from start to end of second block (separator)
    src = fileHeader + '\n\n' + sep() + src.slice(secondBlockEnd);
  }

  writeFileSync(filepath, src, 'utf8');
  const name = filepath.split('/').pop();
  check(name, src);
  return src;
}

// ============================================================
// File-specific definitions
// ============================================================

const FILES = {
  'getAnimatedPicture.js': blk(
    'filename: getAnimatedPicture.js',
    'Version 1.0',
    'Purpose: Animate an image via Replicate (Veo) and save the video to',
    '         ./pub/documents, returning a public URL.'
  ),
  'getBan.js': blk(
    'filename: getBan.js',
    'Version 1.0',
    'Purpose: Send a ban request to the configured admin via DM.'
  ),
  'getConfluence.js': blk(
    'filename: getConfluence.js',
    'Version 1.0',
    'Purpose: Confluence Cloud proxy with v2 pages (create/append/read/list/delete/move),',
    '         Markdown to storage HTML, enforced space, and v1 attachment upload.'
  ),
  'getGoogle.js': blk(
    'filename: getGoogle.js',
    'Version 1.0',
    'Purpose: Perform Google Custom Search via toolsconfig and expose results',
    '         as a function toolcall.'
  ),
  'getHistory.js': blk(
    'filename: getHistory.js',
    'Version 1.0',
    'Purpose: Retrieve channel history with dump/summary/chunk modes, including',
    '         paging, filtering, and OpenAI summaries across one or many channels.'
  ),
  'getImage.js': blk(
    'filename: getImage.js',
    'Version 1.0',
    'Purpose: Generate high-quality images via OpenAI API and persist them to',
    '         ./pub/documents with AI prompt enhancement and aspect handling.'
  ),
  'getImageDescription.js': blk(
    'filename: getImageDescription.js',
    'Version 1.0',
    'Purpose: Vision analysis via Chat Completions using one image passed as',
    '         args.imageURL.'
  ),
  'getImageSD.js': blk(
    'filename: getImageSD.js',
    'Version 1.0',
    'Purpose: Generate images via Stable Diffusion A1111 API, save to',
    '         ./pub/documents and return public links.'
  ),
  'getInformation.js': blk(
    'filename: getInformation.js',
    'Version 1.0',
    'Purpose: Query channel context in MariaDB using fixed-size clusters to build',
    '         info snippets ranked by coverage then frequency.'
  ),
  'getJira.js': blk(
    'filename: getJira.js',
    'Version 1.0',
    'Purpose: Jira Cloud proxy with high-level ops and normalization/repair',
    '         for requests and payloads.'
  ),
  'getLocation.js': blk(
    'filename: getLocation.js',
    'Version 1.0',
    'Purpose: Generate Street View image/link, interactive pano, and Google Maps',
    '         URL with optional directions text.'
  ),
  'getPDF.js': blk(
    'filename: getPDF.js',
    'Version 1.0',
    'Purpose: Toolcall-ready HTML to PDF/HTML generator that saves to',
    '         ../pub/documents, requires CSS, and uses toolsconfig.getPDF settings.'
  ),
  'getText.js': blk(
    'filename: getText.js',
    'Version 1.0',
    'Purpose: Toolcall-ready saver for arbitrary plaintext into ../pub/documents',
    '         with a guessed extension.'
  ),
  'getTime.js': blk(
    'filename: getTime.js',
    'Version 1.0',
    'Purpose: Return current UTC time (ISO 8601) as tool output.'
  ),
  'getTimeline.js': blk(
    'filename: getTimeline.js',
    'Version 1.0',
    'Purpose: Return stored timeline periods for the current channel with',
    '         indices, timestamps, and summaries.'
  ),
  'getToken.js': blk(
    'filename: getToken.js',
    'Version 1.0',
    'Purpose: Accept an image or video URL, convert videos to GIF, apply a',
    '         circular mask plus a single-color ring, and return public URLs.'
  ),
  'getVideoFromText.js': blk(
    'filename: getVideoFromText.js',
    'Version 1.0',
    'Purpose: Create a short video from text via Replicate (Google Veo 3), save',
    '         it under ./pub/documents, and return a public URL.'
  ),
  'getWebpage.js': blk(
    'filename: getWebpage.js',
    'Version 1.0',
    'Purpose: Fetch webpages, dump cleaned text or summarize via OpenAI if long.'
  ),
  'getYoutube.js': blk(
    'filename: getYoutube.js',
    'Version 1.0',
    'Purpose: Fetch YouTube transcripts, then dump or summarize; optional search.'
  ),
  'interface.js': blk(
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

    // Step 1: Apply generic block reformatting
    src = reformatAllBlocks(src);

    // Step 2: Replace the file header (first two blocks) with the standard one
    const header = FILES[name];
    if (header) {
      // Find and replace the first block + separator
      const firstBorderEnd = src.indexOf(B) + B.length;
      const secondBorderStart = src.indexOf(B, firstBorderEnd);
      const secondBorderEnd = secondBorderStart + B.length;
      // Find the third border (end of separator)
      const thirdBorderStart = src.indexOf(B, secondBorderEnd + 1);
      const thirdBorderEnd = thirdBorderStart !== -1 ? thirdBorderStart + B.length : secondBorderEnd;

      // Check if there's a separator after the first block
      const betweenBlocks = src.slice(firstBorderEnd, secondBorderStart).trim();
      if (betweenBlocks === '') {
        // The second block right after first is the separator
        src = header + '\n\n' + sep() + src.slice(thirdBorderEnd);
      } else {
        // No separator - just replace first block
        const firstBorderStart = src.indexOf(B);
        src = header + '\n\n' + sep() + '\n\n' + src.slice(firstBorderEnd + 1);
      }
    }

    writeFileSync(filepath, src, 'utf8');
    check(name, src);
  } catch (e) {
    console.error(`ERROR ${name}: ${e.message}`);
  }
}
