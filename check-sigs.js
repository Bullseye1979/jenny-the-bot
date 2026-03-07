function content(text) { return '/* ' + text.padEnd(80) + '*'; }

const tests = [
  ['applyStrict1', 'functionSignature: applyStrictHierarchy (workingObject, cfgChannels,'],
  ['applyStrict2', '                   channelId, flow, userId)'],
  ['getLlm1', 'functionSignature: getLlmLabels (endpoint, apiKey, model,'],
  ['getLlm2', '                   systemPrompt, userText, validTags, timeoutMs)'],
  ['getLlm3', 'functionSignature: getLlmLabels (endpoint, apiKey, model, systemPrompt,'],
  ['getLlm4', '                   userText, validTags, timeoutMs)'],
];

for (const [id, text] of tests) {
  const line = content(text);
  const ok = line.length === 84 ? 'OK' : 'OVERFLOW(' + line.length + ')';
  console.log(id + ' ' + ok + ' [' + text.length + ']: ' + text);
}
