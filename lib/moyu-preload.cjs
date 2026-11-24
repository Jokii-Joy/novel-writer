// Isolated bridge for the native document strip. The page gets three methods
// only: read the opening draft, stream edits to the main process, and hide.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moyu', {
  init: () => ipcRenderer.invoke('nw-moyu:init'),
  draft: (text) => ipcRenderer.send('nw-moyu:draft', String(text == null ? '' : text)),
  hide: (text) => ipcRenderer.send('nw-moyu:hide', text === undefined ? undefined : String(text)),
});
