'use strict';

// The pairing page is local and sandboxed; it reaches the program through
// these two calls only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pairing', {
  open: () => ipcRenderer.invoke('pair:open'),
  submit: (code) => ipcRenderer.invoke('pair:submit', { code }),
});
