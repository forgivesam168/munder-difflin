import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';

/** One product window foundation, including the production preload, in both modes. */
export function createApplicationWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
  return new BrowserWindow({
    ...options,
    webPreferences: {
      ...options.webPreferences,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
}
