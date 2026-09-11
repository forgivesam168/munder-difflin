'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Four fixed synthetic requests; no arbitrary channels, roots or payloads.
contextBridge.exposeInMainWorld('researchResult', Object.freeze({
  control: () => ipcRenderer.invoke('research:project-result', undefined, 'control'),
  revoked: () => ipcRenderer.invoke('research:project-result', undefined, 'revoked'),
  readControl: () => ipcRenderer.invoke('research:project-result', undefined, 'read-control'),
  readRevoked: () => ipcRenderer.invoke('research:project-result', undefined, 'read-revoked')
}));
