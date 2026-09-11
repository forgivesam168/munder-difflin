'use strict';

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

// Trusted research callers supply a path in their already-validated fresh run.
// A failed staged write/replacement retains the previous snapshot and throws.
// Failed temporary files remain for diagnosis; no cleanup or power-loss guarantee.
module.exports = function writeReceipt(filename, receipt, io = fs) {
  const json = JSON.stringify(receipt, null, 2);
  if (json === undefined) throw new TypeError('Receipt must serialize to JSON');
  const temporary = `${filename}.${randomUUID()}.tmp`;
  io.writeFileSync(temporary, json, { flag: 'wx', mode: 0o600 });
  io.renameSync(temporary, filename);
};
