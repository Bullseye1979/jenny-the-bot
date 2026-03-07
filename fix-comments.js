import { readFileSync, writeFileSync } from 'fs';

const BASE = 'W:/home/discordbot/jenny-the-bot/development/modules/';

// ── Format helpers ──────────────────────────────────────────────────────────
// Border: 86 chars  (/  + 84* + /)
// Open border: 85 chars  (/ + 84*)
// Content: 84 chars  (/* + space + 80-char text area + *)
function border()      { return '/' + '*'.repeat(84) + '/'; }
function openBorder()  { return '/' + '*'.repeat(84); }
function content(text) { return '/* ' + text.padEnd(80) + '*'; }

// Purpose line text budget: 80 - 9 = 71 chars for description
// Continuation line budget: 80 - 9 = 71 chars for description

function makeHeader(filename, purpose, purposeLine2) {
  const lines = [
    openBorder(),
    content('filename: ' + filename),
    content('Version 1.0'),
    content('Purpose: ' + purpose),
  ];
  if (purposeLine2) lines.push(content('         ' + purposeLine2));
  lines.push(border());
  lines.push('');
  lines.push(border());
  lines.push(content(''));
  lines.push(border());
  return lines.join('\n');
}

function makeFuncSig(sig, line2, line3) {
  const lines = [
    border(),
    content('functionSignature: ' + sig),
    content(line2),
  ];
  if (line3) lines.push(content(line3));
  lines.push(border());
  return lines.join('\n');
}

// For long signatures that need to wrap across two sig lines
function makeFuncSigWrapped(sig1, sig2, desc) {
  return [
    border(),
    content('functionSignature: ' + sig1),
    content('                   ' + sig2),
    content(desc),
    border(),
  ].join('\n');
}

// Remove trailing inline // comment from a single code line.
// Does not touch lines that are purely comment lines.
function removeTrailingComment(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return line;

  let inStr = false;
  let strCh = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (!inStr) {
      if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
      if (c === '/' && line[i + 1] === '/') {
        return line.slice(0, i).trimEnd();
      }
    } else {
      if (c === '\\') { i++; continue; }
      if (c === strCh) { inStr = false; }
    }
  }
  return line;
}

function cleanCode(text) {
  return text.split('\n').map(removeTrailingComment).join('\n');
}

function read(name) {
  return readFileSync(BASE + name, 'utf8').replace(/\r\n/g, '\n');
}

function write(name, text) {
  writeFileSync(BASE + name, text.replace(/\n/g, '\r\n'));
  console.log('  wrote:', name);
}

// Normalize a captured sig string: strip trailing spaces, '*/' padding
function normSig(raw) {
  // Remove trailing */ with optional spaces before it (old format: 'sig   */')
  return raw.replace(/\s*\*\/\s*$/, '').replace(/\s+$/, '');
}

// Generic function-sig block replacer for /* */ style blocks (old format with closing */)
// Also handles new format without closing slash on content lines.
function replaceFuncSigs(code, funcMap) {
  return code.replace(
    /\/\*+\/\n\/\* functionSignature: ([^\n]+)\n(?:\/\* [^\n]*\n)+\/\*+\/\n/g,
    (m, sig) => {
      const key = normSig(sig);
      const desc = funcMap[key];
      if (!desc) return m;
      return makeFuncSig(key, desc) + '\n';
    }
  );
}

// Generic function-sig block replacer for /**** (no closing slash on open) style
function replaceFuncSigsOpen(code, funcMap) {
  return code.replace(
    /\/\*+\n\/\* functionSignature: ([^\n]+)\n(?:\/\* [^\n]*\n)+\/\*+\/\n/g,
    (m, sig) => {
      const key = normSig(sig);
      const desc = funcMap[key];
      if (!desc) return m;
      return makeFuncSig(key, desc) + '\n';
    }
  );
}

// Strip ALL header blocks: remove everything from start up to (but not including)
// the first non-comment, non-empty line (i.e. the first import/const/export line).
function stripHeader(src) {
  const lines = src.split('\n');
  let firstCodeLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    // Skip blank lines and any comment block lines
    if (t === '') { firstCodeLine = i + 1; continue; }
    if (t.startsWith('/*') || t.startsWith('*') || t.startsWith('//')) {
      firstCodeLine = i + 1; continue;
    }
    // Found a real code line
    firstCodeLine = i;
    break;
  }
  return lines.slice(firstCodeLine).join('\n');
}

// Strip bard-style header (uses ' * ' prefix style) — same logic
function stripBardHeader(src) {
  return stripHeader(src);
}

// ============================================================
// 00005-discord-status-prepare.js
// ============================================================
{
  const src = read('00005-discord-status-prepare.js');
  const lines = src.split('\n');
  // File is already in correct format (open border, 3 content, close border, blank, close border, empty content, close border)
  // Code starts at line 9 (after header 0-8)
  const codeBlock = lines.slice(9).join('\n');

  const header = makeHeader(
    'discord-status-prepare.js',
    'Prepares AI prompt for Discord presence generation.'
  );

  // Function sig blocks already in correct format — just clean inline comments
  const code = cleanCode(codeBlock);
  write('00005-discord-status-prepare.js', header + '\n' + code);
}

// ============================================================
// 00010-core-channel-config.js
// ============================================================
{
  const src = read('00010-core-channel-config.js');
  const header = makeHeader(
    'core-channel-config.js',
    'Applies strict hierarchical channel/flow/user overrides.'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'isPlainObject (v)':
      'true if v is a plain object.',
    'normalizeStr (v)':
      'a trimmed string from any value.',
    'normalizeStrList (v)':
      'a list of trimmed non-empty strings.',
    'includesCI (list, value)':
      'true if list contains value (case-insensitive).',
    'deepMergePlain (target, source)':
      'a deep-merged plain object; arrays are replaced.',
    'matchChannel (node, channelId)':
      'true if channelId matches node.channelMatch.',
    'matchFlow (node, flow)':
      'true if flow matches node.flowMatch (case-insensitive).',
    'matchUser (node, userId)':
      'true if userId matches node.userMatch.',
    'applyOverrides (workingObject, overrides)':
      'the count of keys applied from overrides onto workingObject.',
    'getEffectiveChannelId (workingObject)':
      '"DM" for DM contexts, otherwise the channel id string.',
    'ensureFlow (workingObject, effectiveChannelId, log)':
      'the flow string; defaults to "discord" for DMs when empty.',
    'pickLastMatchingIndex (list, matcherFn)':
      '{ index, count } where index is the last match position.',
    'applyStrictHierarchy-WRAPPED': 'SKIP',
    'getChannelConfig (coreData)':
      'coreData after applying hierarchical overrides onto workingObject.',
  };

  code = replaceFuncSigs(code, funcMap);

  // applyStrictHierarchy has a long sig — handle separately with wrapped format
  code = code.replace(
    /\/\*+\/\n\/\* functionSignature: applyStrictHierarchy[^\n]+\n(?:\/\*[^\n]*\n)+\/\*+\/\n/g,
    makeFuncSigWrapped(
      'applyStrictHierarchy (workingObject, cfgChannels,',
      'channelId, flow, userId)',
      '{ appliedKeys, matchedRules, warnings } from hierarchical matching.'
    ) + '\n'
  );

  write('00010-core-channel-config.js', header + '\n' + code);
}

// ============================================================
// 00020-discord-channel-gate.js
// ============================================================
{
  const src = read('00020-discord-channel-gate.js');
  const header = makeHeader(
    'discord-channel-gate.js',
    'Stops the flow when a channel is not allowed and logs the outcome.'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'getChannelGate (coreData)':
      'coreData; sets stop=true when channel is not allowed and logs the result.',
  };
  code = replaceFuncSigs(code, funcMap);
  write('00020-discord-channel-gate.js', header + '\n' + code);
}

// ============================================================
// 00021-api-token-gate.js
// ============================================================
{
  const src = read('00021-api-token-gate.js');
  const header = makeHeader(
    'api-token-gate.js',
    'Gates API requests: apiEnabled=0 always blocks; apiEnabled=1 checks',
    'Bearer token against apiSecret. Only runs for the "api" flow.'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'getApiEnabled (wo)':
      'the numeric apiEnabled flag; defaults to 1 when not configured.',
    'getApiSecret (wo)':
      'apiSecret from workingObject; empty string means gate disabled.',
    'getBearerToken (wo)':
      'the Bearer token from workingObject.httpAuthorization.',
    'getApiTokenGate (coreData)':
      'coreData; stops the pipeline when API access is denied.',
  };
  code = replaceFuncSigs(code, funcMap);
  write('00021-api-token-gate.js', header + '\n' + code);
}

// ============================================================
// 00022-discord-gdpr-gate.js
// ============================================================
{
  const src = read('00022-discord-gdpr-gate.js');
  const header = makeHeader(
    'discord-gdpr-gate.js',
    'GDPR gate for discord and discord-voice flows; sends disclaimer DM',
    'once, enforces consent, and skips DMs and bot users.'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'getTableName (coreData)':
      'the consent table name resolved from configuration.',
    'getDbConfig (wo)':
      'the DB connection config object or null if incomplete.',
    'getSimpleTemplate (str, vars)':
      'the string with {{var}} placeholders replaced.',
    'getDisclaimerText (wo)':
      'the disclaimer text from workingObject or empty string.',
    'getBuildDisclaimerFromWO (wo, { userId, channelId, flow })':
      'the disclaimer { body, embed } or null when text is missing.',
    'setHardBlock (wo, body)':
      'nothing; sets stop/blocked/skipLLM flags on workingObject.',
    'setSendDisclaimerDM (wo, ctx, log)':
      'true if the disclaimer DM was sent successfully.',
    'setEnsureConsentTable (conn, table)':
      'nothing; creates the consent table when it does not exist.',
    'getGdprGate (coreData)':
      'coreData after enforcing the GDPR consent gate.',
  };
  code = replaceFuncSigs(code, funcMap);
  write('00022-discord-gdpr-gate.js', header + '\n' + code);
}

// ============================================================
// 00025-discord-admin-gdpr.js
// ============================================================
{
  const src = read('00025-discord-admin-gdpr.js');
  const header = makeHeader(
    'discord-admin-gdpr.js',
    'Handles /gdpr (text|voice) (0|1) command; updates consent table and',
    'resets disclaimer when both chat and voice consent are 0.'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'getTableName (coreData)':
      'the consent table name resolved from configuration.',
    'getDbConfig (wo)':
      'the DB connection config object or null if incomplete.',
    'getParseValue (x)':
      '0 or 1 from a numeric-like value.',
    'getAdminOptionValue (opts)':
      'the option value from an object or array of option objects.',
    'setEnsureTable (conn, table)':
      'nothing; creates the consent table when it does not exist.',
    'setEnsureRow (conn, table, userId, channelId)':
      'nothing; inserts a default consent row when missing.',
    'getRow (conn, table, userId, channelId)':
      'the consent row as { chat, voice, disclaimer, updatedAt }.',
    'setUpdateText (conn, table, { userId, channelId, value })':
      'nothing; updates chat consent and touches updated_at.',
    'setUpdateVoice (conn, table, { userId, channelId, value })':
      'nothing; updates voice consent and touches updated_at.',
    'setResetDisclaimerIfBothZero (conn, table, { userId, channelId })':
      'true if disclaimer was reset to 0 (both consents are 0).',
    'getDiscordAdminGdpr (coreData)':
      'coreData after updating GDPR consent flags.',
  };
  code = replaceFuncSigs(code, funcMap);
  write('00025-discord-admin-gdpr.js', header + '\n' + code);
}

// ============================================================
// 00030-discord-voice-transcribe.js
// ============================================================
{
  const src = read('00030-discord-voice-transcribe.js');
  const header = makeHeader(
    'discord-voice-transcribe.js',
    'Captures Discord voice with VAD-style filtering and Whisper',
    'transcription; stores result in workingObject.payload.'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'getTmpFile (ext)':
      'a unique temporary file path object { dir, file }.',
    'getPcmToWav (pcmReadable, options)':
      'a promise resolving to { dir, file } for the converted WAV.',
    'getBufferPcmToWav (pcmBuffer, options)':
      'a promise resolving to { dir, file } for the WAV from buffer.',
    'getAnalyzePcmInt16 (samples, frameSamples)':
      'voice stats: { totalFrames, snrDb, voicedRatio, usefulMs, mask }.',
    'getAnalyzeWav (filePath, frameSamples)':
      'voice analysis stats from a WAV file on disk.',
    'getVoicedOnlyWavFromFile (filePath, mask, frameSamples, options)':
      'a promise resolving to { dir, file } for the voiced WAV or null.',
    'getTranscribeUrl (whisperEndpoint)':
      'the normalized Whisper transcription endpoint URL.',
    'getTranscribeOpenAI (filePath, { model, language, apiKey, endpoint })':
      'the transcribed text string from OpenAI Whisper.',
    'getCaptureOneSegment (receiver, userId, { silenceMs, maxMs, frameSamples })':
      '{ dir, file, endedBy } for the captured voice segment.',
    'getDiscordVoiceTranscribe (coreData)':
      'coreData after capturing and transcribing voice into payload.',
  };
  code = replaceFuncSigsOpen(code, funcMap);
  write('00030-discord-voice-transcribe.js', header + '\n' + code);
}

// ============================================================
// 00032-discord-add-files.js
// ============================================================
{
  const src = read('00032-discord-add-files.js');
  const header = makeHeader(
    'discord-add-files.js',
    'Appends Discord file URLs from workingObject.fileUrls into payload',
    'as plain lines (one URL per line).'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'getToString (v)':
      'a safe string conversion of v.',
    'getIsHttpUrl (s)':
      'true if s is a non-empty http(s) URL string.',
    'getNormalizedFileUrls (wo)':
      'a deduplicated array of valid http/https URL strings.',
    'getFilesBlock (urls)':
      'a plain text block of URLs, one per line.',
    'getBasePayload (wo)':
      'the current payload text from workingObject.',
    'setPayload (wo, text)':
      'nothing; writes the payload text back to workingObject.',
    'getShouldSkipForSource (wo)':
      'true if source is set and is not "discord".',
    'getCore (coreData)':
      'coreData after appending file URLs to payload.',
  };
  code = replaceFuncSigsOpen(code, funcMap);
  write('00032-discord-add-files.js', header + '\n' + code);
}

// ============================================================
// 00035-bard-admin-join.js
// ============================================================
{
  const src = read('00035-bard-admin-join.js');
  const header = makeHeader(
    'bard-admin-join.js',
    'Handles /bardjoin and /bardleave in the discord-admin flow.',
    'Uses the Bard Bot client to join or leave voice channels.'
  );

  let code = stripBardHeader(src);
  code = cleanCode(code);

  // Old bard-style: /****\n * functionSignature: X\n * purpose: Y\n ****/
  code = code.replace(
    /\/\*+\s*\n \* functionSignature: ([^\n]+)\n \* purpose: ([^\n]+)\n \*+\/\s*\n/g,
    (m, sig, purpose) => makeFuncSig(sig.trim(), purpose.trim()) + '\n'
  );

  write('00035-bard-admin-join.js', header + '\n' + code);
}

// ============================================================
// 00036-bard-cron.js
// ============================================================
{
  const src = read('00036-bard-cron.js');
  const header = makeHeader(
    'bard-cron.js',
    'Cron module for the bard-label-gen flow. Reads channel context,',
    'queries LLM for 3 mood tags, stores them in bard:labels:guildId.'
  );

  let code = stripBardHeader(src);
  code = cleanCode(code);

  code = code.replace(
    /\/\*+\s*\n \* functionSignature: ([^\n]+)\n \* purpose: ([^\n]+)\n \*+\/\s*\n/g,
    (m, sig, purpose) => makeFuncSig(sig.trim(), purpose.trim()) + '\n'
  );

  // Fix getLlmLabels sig block (sig line is too long — wrap it)
  code = code.replace(
    /\/\*+\/\n\/\* functionSignature: getLlmLabels[^\n]+\n(?:\/\*[^\n]*\n)+\/\*+\/\n/g,
    makeFuncSigWrapped(
      'getLlmLabels (endpoint, apiKey, model, systemPrompt,',
      'userText, validTags, timeoutMs)',
      'an array of up to 3 valid lowercase tag strings from the LLM.'
    ) + '\n'
  );

  write('00036-bard-cron.js', header + '\n' + code);
}

// ============================================================
// 00040-discord-admin-join.js
// ============================================================
{
  const src = read('00040-discord-admin-join.js');
  const header = makeHeader(
    'discord-admin-join.js',
    'Handles /join and /leave; manages voice connection and per-guild',
    'session store via admin snapshots.'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'setLogVoiceStateDiag (connection, log, ctx)':
      'Logs voice connection state transitions for diagnostics.',
    'getRegistry ()':
      'the voice session registry object from the shared key.',
    'setAddSessionKey (sessionKey)':
      'Adds a session key to the shared registry list.',
    'setRemoveSessionKey (sessionKey)':
      'Removes a session key from the shared registry list.',
    'getResolveClient (wo)':
      'the Discord client from the registry reference in workingObject.',
    'getResolveGuildAndMember (client, guildId, userId)':
      'the { guild, member } objects, or { null, null } on failure.',
    'getDiscordJoinLeave (coreData)':
      'coreData after handling /join or /leave for the per-guild session.',
  };
  code = replaceFuncSigs(code, funcMap);
  write('00040-discord-admin-join.js', header + '\n' + code);
}

// ============================================================
// 00041-webpage-auth.js
// ============================================================
{
  const src = read('00041-webpage-auth.js');
  const header = makeHeader(
    'webpage-auth.js',
    'Discord OAuth2 SSO for webpage ports. Handles login, callback,',
    'and logout. Writes wo.webAuth; non-auth requests pass through.'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'setSendNow (wo)':
      'Sends the HTTP response immediately from workingObject.http.response.',
    'setJsonResp (wo, status, obj)':
      'Sets a JSON HTTP response on workingObject.http.response.',
    'setRedirect (wo, url, cookies)':
      'Sets a 302 redirect response with optional Set-Cookie headers.',
    'getBaseUrl (wo)':
      'the public base URL (proto://host) from request headers.',
    'getIsHttps (wo)':
      'true if the request was made over HTTPS.',
    'getParseCookies (cookieHeader)':
      'a parsed cookie map from the Cookie header string.',
    'getB64UrlEncode (input)':
      'the base64url-encoded string from a buffer or string.',
    'getB64UrlDecode (s)':
      'the decoded Buffer from a base64url string.',
    'getHmac (secret, data)':
      'the HMAC-SHA256 digest buffer.',
    'getSignToken (secret, payloadObj)':
      'a signed token string (base64url payload + dot + signature).',
    'getVerifyToken (secret, token)':
      'the parsed payload if the token is valid, null otherwise.',
    'getCookieLine (name, value, opts)':
      'a Set-Cookie header string.',
    'getRandId ()':
      'a random base64url-encoded 24-byte ID string.',
    'getHttpPostForm (urlStr, formObj)':
      'a promise resolving to { status, body, json } from a form POST.',
    'getHttpGetJson (urlStr, headers)':
      'a promise resolving to the parsed JSON body or null.',
    'getNormalizeRoleLabel (cfg, roleValue)':
      'the normalized role label string.',
    'getRoleFromMember (cfg, member)':
      'the { role, roles, roleIds } resolved from guild member data.',
    'getIsAllowedByRole (cfg, roles)':
      'true if the member roles satisfy the allowRoleIds config.',
    'setApplyAuthToWorkingObject (wo, cfg, sess)':
      'Writes wo.webAuth from the verified session object.',
    'getIsAuthPath (p)':
      'true if the path is an /auth/* route.',
    'getNextFromUrl (wo)':
      'the next URL path for post-login redirect.',
    'getPorts (cfg)':
      'the { loginPort, ports } configuration object.',
    'getWebpageAuth (coreData)':
      'coreData after handling Discord OAuth2 auth for the request.',
  };
  code = replaceFuncSigs(code, funcMap);
  write('00041-webpage-auth.js', header + '\n' + code);
}

// ============================================================
// 00043-webpage-menu.js
// ============================================================
{
  const src = read('00043-webpage-menu.js');
  const header = makeHeader(
    'webpage-menu.js',
    'Global menu provider for webpage flows; filters items by webAuth role.'
  );

  let code = stripHeader(src);
  code = cleanCode(code);

  const funcMap = {
    'getNormFlow (wo)':
      'the normalized flow string from workingObject.',
    'getNormRoleOrEmpty (wo)':
      'the normalized role string or empty string when not set.',
    'getIsAllowed (role, rolesArr)':
      'true if the role is allowed by the roles array.',
    'getWebpageMenu (coreData)':
      'coreData after setting wo.web.menu filtered by role.',
  };
  code = replaceFuncSigs(code, funcMap);
  write('00043-webpage-menu.js', header + '\n' + code);
}

console.log('\nAll 13 files processed.');
