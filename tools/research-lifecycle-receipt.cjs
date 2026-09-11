'use strict';

// A taskkill exit code proves command outcome, not absence of descendants.
// Until a tree supervisor supplies independent evidence, this fixture cannot PASS.
module.exports = function lifecycleReceipt(identity, persist, now = () => new Date().toISOString()) {
  const receipt = {
    ...identity, started: now(), phase: 'prepared', timedOut: false,
    cleanup: { status: 'not-attempted' }, treeExit: 'unverified', result: 'INCOMPLETE'
  };
  const persistSnapshot = () => persist(JSON.parse(JSON.stringify(receipt)));
  persistSnapshot(); // Initial failure prevents launch; no process needs cleanup yet.
  const save = () => {
    try { persistSnapshot(); }
    catch {
      // Never let storage failure prevent the caller's subsequent cleanup effects.
      // Later events may persist the latch; no retry loop or raw error payload.
      receipt.persistenceFailed = true;
      receipt.result = 'FAIL';
    }
  };
  return {
    get persistenceFailed() { return receipt.persistenceFailed === true; },
    spawned(pid) { receipt.pid = pid; receipt.phase = 'running'; save(); },
    launchError() {
      // Do not persist arbitrary process error messages or inherited payloads.
      receipt.launchError = true; receipt.result = 'FAIL'; save();
    },
    timeout() { receipt.timedOut = true; receipt.result = 'FAIL'; save(); },
    cleanupStarted() { receipt.cleanup = { status: 'attempting', started: now() }; save(); },
    cleanupFinished(error) {
      receipt.cleanup = { ...receipt.cleanup,
        status: error ? 'command-failed' : 'command-succeeded', finished: now() };
      receipt.result = 'FAIL'; save();
    },
    closed(code, signal) {
      Object.assign(receipt, { phase: 'closed', code, signal, finished: now(), result: 'FAIL' });
      save();
      return 1;
    }
  };
};
