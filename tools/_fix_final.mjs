import { readFileSync, writeFileSync } from 'fs';

const B = '/' + '*'.repeat(82) + '/';
const INNER = 79; // content area width between '/* ' and ' *'

function cl(text) {
  return '/* ' + String(text).padEnd(INNER, ' ') + ' *';
}

function blk(...lines) {
  return B + '\n' + lines.map(cl).join('\n') + '\n' + B;
}

function sep() {
  return B + '\n' + cl('') + '\n' + B;
}

// Wrap text that is longer than INNER chars into multiple lines
function wrapText(text) {
  if (text.length <= INNER) return [text];
  // Try to wrap at a word boundary
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur.length === 0) {
      cur = w;
    } else if (cur.length + 1 + w.length <= INNER) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = '         ' + w; // indent continuation lines
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Build a block with automatic line wrapping
function blkWrap(...lines) {
  const wrapped = [];
  for (const line of lines) {
    const wl = wrapText(String(line));
    wrapped.push(...wl);
  }
  return B + '\n' + wrapped.map(cl).join('\n') + '\n' + B;
}

// Extract text content from a raw comment line
function extractLineText(line) {
  let t = line.trim();
  // Remove trailing */
  t = t.replace(/\s*\*\/\s*$/, '').trimEnd();
  // Remove trailing *
  t = t.replace(/\s*\*\s*$/, '').trimEnd();
  // Remove leading /*
  if (t.startsWith('/*')) t = t.slice(2).trimStart();
  else if (t.startsWith('*')) t = t.slice(1).trimStart();
  return t;
}

// Reformat all comment blocks in a source string
function reformatAllBlocks(src) {
  const lines = src.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i].replace(/\r$/, '');
    const t = raw.trim();

    // Detect comment block: starts with /* and has many stars (border pattern)
    if (/^\/\*{5,}/.test(t)) {
      // Collect entire block until closing border
      const blockRaw = [raw];
      let j = i + 1;
      while (j < lines.length) {
        const bl = lines[j].replace(/\r$/, '');
        const bt = bl.trim();
        blockRaw.push(bl);
        j++;
        // Stop at: border line ending with /, or */ on its own, or next border
        if (/^\/\*{5,}\/$/.test(bt) || bt === '*/') break;
        // Also stop if this line itself ends with */ and is not a border line
        if (bt.endsWith('*/') && !/^\/\*{5,}/.test(bt)) break;
      }

      // Extract content from block
      const contentTexts = [];
      for (const bl of blockRaw) {
        const bt = bl.trim();
        // Skip border lines
        if (/^\/\*{5,}\/?$/.test(bt)) continue;
        if (bt === '') continue;
        if (bt === '*/' || bt === '*') continue;
        const text = extractLineText(bt);
        if (text && !(/^\*+$/.test(text))) contentTexts.push(text);
      }

      if (contentTexts.length === 0) {
        out.push(sep());
      } else {
        // Build block with proper wrapping
        const wrappedContent = [];
        for (const t of contentTexts) {
          wrappedContent.push(...wrapText(t));
        }
        out.push(B);
        wrappedContent.forEach(t => out.push(cl(t)));
        out.push(B);
      }
      i = j;
      continue;
    }

    // Inline // comment on code line - remove it
    out.push(stripInlineComment(raw));
    i++;
  }

  return out.join('\n');
}

function stripInlineComment(line) {
  let inSingle = false, inDouble = false, inTemplate = false;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : '\0';

    if (ch === '\\' && (inSingle || inDouble || inTemplate)) { i++; continue; }
    if (!inSingle && !inDouble && !inTemplate) {
      if (ch === '"') { inDouble = true; continue; }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === '`') { inTemplate = true; continue; }
    }
    if (inDouble && ch === '"' && prev !== '\\') { inDouble = false; continue; }
    if (inSingle && ch === "'" && prev !== '\\') { inSingle = false; continue; }
    if (inTemplate && ch === '`' && prev !== '\\') { inTemplate = false; continue; }

    if (!inSingle && !inDouble && !inTemplate) {
      if (ch === '/' && line[i + 1] === '/') {
        return line.slice(0, i).trimEnd();
      }
    }
  }
  return line;
}

function replaceFileHeader(src, headerBlock) {
  // Find the first border
  const firstBorderIdx = src.indexOf(B);
  if (firstBorderIdx === -1) return src;
  const afterFirst = firstBorderIdx + B.length;
  // Find the second border (end of first block)
  const secondBorderIdx = src.indexOf(B, afterFirst);
  if (secondBorderIdx === -1) return src;
  const afterSecond = secondBorderIdx + B.length;
  // Find third border (end of separator)
  const thirdBorderIdx = src.indexOf(B, afterSecond + 1);
  const afterThird = thirdBorderIdx !== -1 ? thirdBorderIdx + B.length : afterSecond;

  // Check if there's a separator between first and second blocks
  return headerBlock + '\n\n' + sep() + src.slice(afterThird);
}

function check(name, src) {
  const lines = src.split('\n');
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (l.startsWith('/*')) {
      if (l.length !== 84) bad.push(`L${i+1}(${l.length}): "${l.slice(0,50)}..."`);
    }
  }
  if (bad.length) {
    console.log(`WARN ${name}: ${bad.slice(0, 3).join(' | ')}`);
  } else {
    console.log(`OK: ${name}`);
  }
}

const HEADERS = {
  'getAnimatedPicture.js': blkWrap(
    'filename: getAnimatedPicture.js',
    'Version 1.0',
    'Purpose: Animate an image via Replicate (Veo) and save the video to ./pub/documents, returning a public URL.'
  ),
  'getBan.js': blkWrap(
    'filename: getBan.js',
    'Version 1.0',
    'Purpose: Send a ban request to the configured admin via DM.'
  ),
  'getConfluence.js': blkWrap(
    'filename: getConfluence.js',
    'Version 1.0',
    'Purpose: Confluence Cloud proxy with v2 pages (create/append/read/list/delete/move), Markdown to storage HTML, enforced space, and v1 attachment upload.'
  ),
  'getGoogle.js': blkWrap(
    'filename: getGoogle.js',
    'Version 1.0',
    'Purpose: Perform Google Custom Search via toolsconfig and expose results as a function toolcall.'
  ),
  'getHistory.js': blkWrap(
    'filename: getHistory.js',
    'Version 1.0',
    'Purpose: Retrieve channel history with dump/summary/chunk modes, including paging, filtering, and OpenAI summaries across one or many channels.'
  ),
  'getImage.js': blkWrap(
    'filename: getImage.js',
    'Version 1.0',
    'Purpose: Generate high-quality images via OpenAI API and persist them to ./pub/documents with AI prompt enhancement and aspect handling.'
  ),
  'getImageDescription.js': blkWrap(
    'filename: getImageDescription.js',
    'Version 1.0',
    'Purpose: Vision analysis via Chat Completions using one image passed as args.imageURL.'
  ),
  'getImageSD.js': blkWrap(
    'filename: getImageSD.js',
    'Version 1.0',
    'Purpose: Generate images via Stable Diffusion A1111 API, save to ./pub/documents and return public links.'
  ),
  'getInformation.js': blkWrap(
    'filename: getInformation.js',
    'Version 1.0',
    'Purpose: Query channel context in MariaDB using fixed-size clusters to build info snippets ranked by coverage then frequency.'
  ),
  'getJira.js': blkWrap(
    'filename: getJira.js',
    'Version 1.0',
    'Purpose: Jira Cloud proxy with high-level ops and normalization/repair for requests and payloads.'
  ),
  'getLocation.js': blkWrap(
    'filename: getLocation.js',
    'Version 1.0',
    'Purpose: Generate Street View image/link, interactive pano, and Google Maps URL with optional directions text.'
  ),
  'getPDF.js': blkWrap(
    'filename: getPDF.js',
    'Version 1.0',
    'Purpose: Toolcall-ready HTML to PDF/HTML generator that saves to ../pub/documents, requires CSS, and uses toolsconfig.getPDF settings.'
  ),
  'getText.js': blkWrap(
    'filename: getText.js',
    'Version 1.0',
    'Purpose: Toolcall-ready saver for arbitrary plaintext into ../pub/documents with a guessed extension.'
  ),
  'getTime.js': blkWrap(
    'filename: getTime.js',
    'Version 1.0',
    'Purpose: Return current UTC time (ISO 8601) as tool output.'
  ),
  'getTimeline.js': blkWrap(
    'filename: getTimeline.js',
    'Version 1.0',
    'Purpose: Return stored timeline periods for the current channel with indices, timestamps, and summaries.'
  ),
  'getToken.js': blkWrap(
    'filename: getToken.js',
    'Version 1.0',
    'Purpose: Accept an image or video URL, convert videos to GIF, apply a circular mask plus a single-color ring, and return public URLs.'
  ),
  'getVideoFromText.js': blkWrap(
    'filename: getVideoFromText.js',
    'Version 1.0',
    'Purpose: Create a short video from text via Replicate (Google Veo 3), save it under ./pub/documents, and return a public URL.'
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

    // Step 1: Reformat all comment blocks
    src = reformatAllBlocks(src);

    // Step 2: Replace file header
    const header = HEADERS[name];
    if (header) {
      src = replaceFileHeader(src, header);
    }

    writeFileSync(filepath, src, 'utf8');
    check(name, src);
  } catch (e) {
    console.error(`ERROR ${name}: ${e.message}`);
    console.error(e.stack);
  }
}
