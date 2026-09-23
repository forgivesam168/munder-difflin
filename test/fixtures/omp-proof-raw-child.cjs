'use strict';
const crypto = require('node:crypto');
const mode = process.argv[2];
if (!['SUCCESS', 'FAILURE', 'TIMEOUT', 'OVERFLOW'].includes(mode)) process.exit(64);
// Fail without changing the raw-byte protocol if any helper, provider or credential environment leaks.
const environmentKeys = Object.keys(process.env);
if (environmentKeys.length !== 1 || environmentKeys[0].toLowerCase() !== 'systemroot'
  || !process.env[environmentKeys[0]].trim()) process.exit(67);
const chunks = [];
let size = 0;
process.stdin.on('data', chunk => {
  size += chunk.length;
  if (size > 64) process.exit(65);
  chunks.push(chunk);
});
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks);
  if (!input.equals(Buffer.from([0, 255, 13, 10, 65]))) process.exit(66);
  process.stdout.write(JSON.stringify({ type: 'fixture_input', bytes: input.length,
    sha256: crypto.createHash('sha256').update(input).digest('hex') }) + '\n');
  // Invalid UTF-8 deliberately proves stderr is not reconstructed from decoded onData.
  process.stderr.write(Buffer.from([255, 0, 69, 82, 82, 10]));
  if (mode === 'TIMEOUT') { setInterval(() => {}, 1000); return; }
  if (mode === 'OVERFLOW') { process.stdout.write(Buffer.alloc(131072, 65)); return; }
  process.stdout.write(JSON.stringify({ type: mode === 'FAILURE' ? 'fixture_failed' : 'fixture_completed',
    result: mode === 'FAILURE' ? 'FAIL' : 'PASS' }) + '\n');
  process.exitCode = mode === 'FAILURE' ? 7 : 0;
});
