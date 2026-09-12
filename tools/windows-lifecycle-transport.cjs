'use strict';
const assert = require('node:assert/strict');
// Shared internal transport extracted from the verified research parent. Callers
// own fixed admission, identity and authorization; this module has no CLI.
module.exports = function transport({ powershell, helperArgs, run, env, receipt, persist,
  accept, inspect = () => {}, mode, test = {}, spawn, setTimeout = global.setTimeout, clearTimeout = global.clearTimeout, outerMs = 85000, bootstrapMs = 30000, fallbackMs = 5000 }) {
  const save = () => {
    try { persist(); } catch { receipt.persistenceFailed = true; receipt.result = 'FAIL'; }
  };
  return new Promise(resolve => {
    let child, ended = false, buffer = '', bytes = 0, ready = false, complete = null, ownedRoot = false;
    let failed = false, killed = false, fallback, bootstrap, outer;
    const fail = reason => { failed = true; receipt.failure = receipt.failure || reason; receipt.result = 'FAIL'; };
    const finish = (code, signal, abandoned = false) => {
      if (ended) return;
      ended = true;
      clearTimeout(bootstrap); clearTimeout(outer); clearTimeout(fallback);
      receipt.helperExit = code; receipt.helperSignal = signal;
      try {
        assert.ok(!abandoned && ready && !buffer.trim() && complete && code === 0 && signal === null);
        assert.equal(complete.run, run);
        const n = complete.native;
        assert.equal(n.Member, true); assert.equal(n.ActiveProcesses, 0);
        // Cleanup is independent of assertion/workload success, including storage faults.
        receipt.cleanup = 'VERIFIED_EMPTY'; receipt.native = n;
        inspect(complete);
        assert.equal(n.ChildExit, 0);
        for (const key of ['TimedOut', 'RootFailed', 'RootTimedOut', 'TerminationSucceeded', 'ReceiptWriteFailed', 'SuspendedBeforeClose']) assert.equal(n[key], false);
        assert.equal(n.QueryErrorCode, null); assert.equal(n.TerminationErrorCode, null);
        accept(complete);
        receipt.result = !failed && !receipt.persistenceFailed ? mode.success : 'FAIL';
      } catch { fail('acceptance'); }
      receipt.phase = 'closed'; save();
      resolve({ run, exitCode: receipt.result === mode.success && !receipt.persistenceFailed ? 0 : 1, receipt });
    };
    const stop = reason => {
      fail(reason); save();
      if (killed || ended) return;
      killed = true;
      // Only this retained helper object, never PID discovery or taskkill.
      try { child.kill(); } catch { fail('helper-stop'); }
      fallback = setTimeout(() => {
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        finish(null, null, true);
      }, fallbackMs);
    };
    try {
      child = spawn(powershell, helperArgs,
      { cwd: run, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { fail('spawn'); finish(null, null); return; }
    bootstrap = setTimeout(() => stop('bootstrap-timeout'), bootstrapMs);
    outer = setTimeout(() => stop('outer-timeout'), outerMs);
    child.on('error', () => { fail('helper-error'); });
    child.stdin.on('error', () => stop('input-error'));
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) stop('output-limit'); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 65536) { stop('output-limit'); return; }
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (!ready && message.phase === 'ready') {
            assert.deepEqual(message, { phase: 'ready' });
            ready = true; clearTimeout(bootstrap); receipt.phase = 'supervising'; save();
          } else if (ready && !complete && message.phase === 'owned-root') {
            assert.ok(test.stopProbe && !ownedRoot);
            assert.deepEqual(Object.keys(message).sort(), ['created', 'phase', 'pid']);
            assert.ok(Number.isSafeInteger(message.pid) && message.pid > 0);
            assert.match(message.created, /^\d+$/);
            ownedRoot = true;
            Promise.resolve().then(() => test.onOwnedRoot({ run, ...message }, () => stop('test-helper-stop')))
              .catch(() => stop('test-observer-failure'));
          } else if (ready && !complete && message.phase === 'failed') {
            assert.equal(message.cleanup, 'UNVERIFIED');
            assert.ok(message.nativeErrorCode === null || Number.isInteger(message.nativeErrorCode));
            receipt.nativeErrorCode = message.nativeErrorCode;
            fail('native-helper'); complete = message;
          } else {
            assert.ok(ready && !complete && message.phase === 'complete'); complete = message;
          }
        } catch { stop('protocol'); }
      }
    });
    child.on('close', (code, signal) => finish(code, signal));
    child.stdin.end(JSON.stringify(env));
  });
};
