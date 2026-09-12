import { controlledStartup } from './controlledStartup';

// Do not statically import index: its service graph has module-evaluation effects.
// A rejected controlled launch never falls back to the ordinary runtime.
async function start(): Promise<void> {
  try {
    const mode = controlledStartup(process.argv, process.env);
    if (mode) {
      const { startControlledApplication } = await import('./controlledApplication');
      await startControlledApplication(mode);
    } else {
      await import('./index');
    }
  } catch {
    // Do not expose environment values or invoke Electron's uncaught-error dialog.
    console.error('Munder startup refused');
    const { app } = await import('electron');
    app.exit(1);
  }
}
void start();
