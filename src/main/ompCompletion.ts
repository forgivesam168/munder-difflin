import { createCoreRuntimeContract, validateTaskResult, type CoreRuntimeContract, type CoreTaskResult } from './codexWorkerContract';
import { coreScopeDigest } from './runtimeAdapter';

/** Deliberately narrow fixture profile, NOT a claim of real-stream conformance.
 * No tools, user messages, silent aborts or multi-turn execution are accepted.
 * A future owned transport must authenticate its stream independently. */
export type OmpCompletionFixtureRecord =
  | { type: 'message_start'; message: { role: 'assistant' } }
  | { type: 'message_update'; delta: string }
  | { type: 'message_end'; message: { role: 'assistant'; content: readonly { type: 'text'; text: string }[]; stopReason: 'stop' } }
  | { type: 'turn_end'; stopReason: 'stop' }
  | { type: 'agent_end'; stopReason: 'stop' };
function record<K extends string>(value: unknown, keys: K[]): asserts value is Record<K, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw new Error('Invalid OMP fixture record');
}
/** Whole EOF-delimited NDJSON input prevents minting before trailing data is inspected.
 * This capability is parser-local only; it cannot publish a production result. */
export function createOmpFixtureCompletionRecognizer(input: CoreRuntimeContract) {
  const core = createCoreRuntimeContract({ ...input, syntheticRoot: input.rootPolicy.root });
  const binding = coreScopeDigest(core);
  const capabilities = new WeakMap<object, CoreTaskResult>();
  let attempted = false;
  return Object.freeze({
    recognize(stream: string): object {
      if (attempted) throw new Error('OMP completion already attempted');
      attempted = true;
      if (typeof stream !== 'string' || Buffer.byteLength(stream) > 1024 * 1024 || !stream.endsWith('\n')) throw new Error('Incomplete OMP stream');
      let phase = 0;
      let result: CoreTaskResult | undefined;
      for (const line of stream.slice(0, -1).split('\n')) {
        const event: unknown = JSON.parse(line);
        if (!event || typeof event !== 'object' || !('type' in event)) throw new Error('Invalid OMP event');
        switch (event.type) {
          case 'message_start':
            record(event, ['type', 'message']); record(event.message, ['role']);
            if (phase !== 0 || event.message.role !== 'assistant') throw new Error('Invalid OMP lifecycle');
            phase = 1; break;
          case 'message_update':
            record(event, ['type', 'delta']);
            if (phase !== 1 || typeof event.delta !== 'string') throw new Error('Invalid OMP delta');
            break;
          case 'message_end': {
            record(event, ['type', 'message']); record(event.message, ['role', 'content', 'stopReason']);
            const message = event.message;
            if (phase !== 1 || message.role !== 'assistant' || message.stopReason !== 'stop'
              || !Array.isArray(message.content) || message.content.length !== 1) throw new Error('Invalid OMP final assistant');
            const content: unknown = message.content[0]; record(content, ['type', 'text']);
            if (content.type !== 'text' || typeof content.text !== 'string') throw new Error('Invalid OMP result payload');
            const payload: unknown = JSON.parse(content.text);
            result = validateTaskResult(payload, core, { resultAlreadyExists: false });
            const identity = payload as CoreTaskResult;
            if (identity.taskDigest !== core.taskDigest
              || identity.sourceCheckpoint.repositoryId !== core.sourceCheckpoint.repositoryId
              || identity.sourceCheckpoint.commitSha !== core.sourceCheckpoint.commitSha
              || identity.sourceCheckpoint.treeSha !== core.sourceCheckpoint.treeSha) throw new Error('OMP exact identity mismatch');
            phase = 2; break;
          }
          case 'turn_end':
          case 'agent_end':
            record(event, ['type', 'stopReason']);
            if (event.stopReason !== 'stop' || phase !== (event.type === 'turn_end' ? 2 : 3)) throw new Error('Invalid OMP terminal lifecycle');
            phase++; break;
          default: throw new Error('Unknown OMP fixture event');
        }
      }
      if (phase !== 4 || !result) throw new Error('Incomplete OMP lifecycle');
      const capability = Object.freeze(Object.defineProperty({}, 'toJSON', {
        value: () => { throw new Error('OMP completion capability is not serializable'); }
      }));
      capabilities.set(capability, result);
      return capability;
    },
    consume(capability: unknown, expected: CoreRuntimeContract): CoreTaskResult {
      const result = capability && typeof capability === 'object' ? capabilities.get(capability) : undefined;
      if (!result) throw new Error('Forged or spent OMP completion');
      if (coreScopeDigest(expected) !== binding) throw new Error('OMP completion scope substitution');
      capabilities.delete(capability as object);
      return result;
    }
  });
}
