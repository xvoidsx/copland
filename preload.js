// copland — preload bridge. The renderer gets exactly this API and nothing
// else: spawn/write/resize/kill PTYs, and subscribe to their output.
// Context isolation stays on; nodeIntegration stays off.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('copland', {
  spawnPty: (cols, rows) => ipcRenderer.invoke('pty:spawn', cols, rows),
  writePty: (id, data) => ipcRenderer.send('pty:write', id, data),
  resizePty: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  killPty: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_event, id, data) => cb(id, data)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_event, id) => cb(id)),
  loadKeybinds: () => ipcRenderer.invoke('config:keybinds'),
});
