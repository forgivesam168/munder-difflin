import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import brandLogo from '@brand/logo.png?url';
import './design/global.css';

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = brandLogo;
document.head.appendChild(favicon);

const splashMark = document.querySelector('#cth-splash .mk');
if (splashMark) {
  const img = document.createElement('img');
  img.src = brandLogo;
  img.alt = 'Munder Difflin';
  img.style.cssText = 'height:56px;width:auto;display:block';
  splashMark.replaceWith(img);
}

const root = document.getElementById('root');
if (!root) throw new Error('No root element');

// Ordinary App imports initialize stores and service consumers. Choose the mode
// before evaluating that graph, using the main-owned preload launch marker.
async function renderApplication(): Promise<void> {
  if (!root) return;
  if (window.cth.controlledRead) {
    const { ControlledRead } = await import('./ControlledRead');
    createRoot(root).render(<StrictMode><ControlledRead /></StrictMode>);
    document.getElementById('cth-splash')?.remove();
  } else {
    await import('./i18n');
    const { App } = await import('./App');
    createRoot(root).render(<StrictMode><App /></StrictMode>);
  }
}
void renderApplication().catch(() => { root.textContent = 'Application startup failed.'; });
