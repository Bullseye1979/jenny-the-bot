function content(text) { return '/* ' + text.padEnd(80) + '*'; }

const tests = [
  ['00005',  'Purpose: ', 'Prepares AI prompt for Discord presence generation.'],
  ['00010',  'Purpose: ', 'Applies strict hierarchical channel/flow/user overrides.'],
  ['00020',  'Purpose: ', 'Stops the flow when a channel is not allowed and logs the outcome.'],
  ['00021a', 'Purpose: ', 'Gates API requests: apiEnabled=0 always blocks; apiEnabled=1 checks'],
  ['00021b', '         ', 'Bearer token against apiSecret. Only runs for the "api" flow.'],
  ['00022a', 'Purpose: ', 'GDPR gate for discord and discord-voice flows; sends disclaimer DM'],
  ['00022b', '         ', 'once, enforces consent, and skips DMs and bot users.'],
  ['00025a', 'Purpose: ', 'Handles /gdpr (text|voice) (0|1) command; updates consent table and'],
  ['00025b', '         ', 'resets disclaimer when both chat and voice consent are 0.'],
  ['00030a', 'Purpose: ', 'Captures Discord voice with VAD-style filtering and Whisper'],
  ['00030b', '         ', 'transcription; stores result in workingObject.payload.'],
  ['00032a', 'Purpose: ', 'Appends Discord file URLs from workingObject.fileUrls into payload'],
  ['00032b', '         ', 'as plain lines (one URL per line).'],
  ['00035a', 'Purpose: ', 'Handles /bardjoin and /bardleave in the discord-admin flow.'],
  ['00035b', '         ', 'Uses the Bard Bot client to join or leave voice channels.'],
  ['00036a', 'Purpose: ', 'Cron module for the bard-label-gen flow. Reads channel context,'],
  ['00036b', '         ', 'queries LLM for 3 mood tags, stores them in bard:labels:guildId.'],
  ['00040a', 'Purpose: ', 'Handles /join and /leave; manages voice connection and per-guild'],
  ['00040b', '         ', 'session store via admin snapshots.'],
  ['00041a', 'Purpose: ', 'Discord OAuth2 SSO for webpage ports. Handles login, callback,'],
  ['00041b', '         ', 'and logout. Writes wo.webAuth; non-auth requests pass through.'],
  ['00043',  'Purpose: ', 'Global menu provider for webpage flows; filters items by webAuth role.'],
];

let ok = true;
for (const [id, prefix, desc] of tests) {
  const text = prefix + desc;
  const line = content(text);
  if (line.length === 84) {
    console.log('OK ' + id + ' [' + text.length + ']: ' + text);
  } else {
    console.log('OVERFLOW ' + id + ' len=' + line.length + ' [' + text.length + ']: ' + text);
    ok = false;
  }
}
if (ok) console.log('\nAll purpose lines fit within 84 chars!');
