import { useEffect, useRef, useState } from 'react';

export function ControlledRead(): JSX.Element {
  const [root, setRoot] = useState('');
  const [path, setPath] = useState('readme.txt');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('Loading project…');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (content) void window.cth.controlledReadDisplayed(content).catch(() => setStatus('Result acknowledgement failed'));
  }, [content]);
  // Runs after the project and controls have committed. Reload acknowledges again
  // but main retains the original Human deadline across documents.
  useEffect(() => {
    if (!root) return;
    let current = true;
    window.cth.controlledReadReady().then(() => {
      if (current) { setReady(true); setStatus('Ready'); }
    }, () => { if (current) setStatus('Ready acknowledgement failed'); });
    return () => { current = false; };
  }, [root]);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    window.cth.controlledReadProject().then(result => {
      if (active.current) { setRoot(result.projectRoot); setStatus('Preparing controls…'); }
    }, () => { if (active.current) setStatus('Project unavailable'); });
    return () => { active.current = false; };
  }, []);
  const read = async (): Promise<void> => {
    setBusy(true); setContent(''); setStatus('Waiting for project consent and read…');
    const result = await window.cth.readFile(root, path);
    if (!active.current) return;
    setBusy(false);
    if (result.ok) { setContent(result.content); setStatus('Read complete'); }
    else setStatus(result.error);
  };
  return <main style={{ padding: 24, background: 'var(--cth-cream-100)', height: '100%', overflow: 'auto' }}>
    <h1>Munder Difflin — Controlled project read</h1>
    <p>Read-only project: {root || 'unavailable'}</p>
    <label>File within project <input value={path} onChange={event => setPath(event.target.value)} /></label>
    <button disabled={!ready || busy} onClick={() => void read()}>Read file</button>
    <button onClick={() => window.location.reload()}>Reload and revoke access</button>
    <p role="status" aria-live="polite">{status}</p>
    <pre style={{ whiteSpace: 'pre-wrap' }}>{content}</pre>
  </main>;
}
