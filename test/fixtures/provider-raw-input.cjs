'use strict';
// Provider-free: stdout is observation only, never a durable task result.
const crypto = require('node:crypto');
let size = 0;
const chunks = [];
process.stdin.on('data', chunk => {
  size += chunk.length;
  if (size > 65536) process.exit(2);
  chunks.push(chunk);
});
process.stdin.on('end', () => {
  const bytes = Buffer.concat(chunks);
  process.stdout.write(JSON.stringify({ eof: true, bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') }) + '\n');
});
