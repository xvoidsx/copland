// copland — main process: window + PTY host.
//
// The renderer never touches node-pty directly. Every pane asks the main
// process for a PTY over IPC; the main process owns the pty.js instances
// and forwards data back to the window that owns them.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

const ptys = new Map();
let nextId = 1;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0a050b',
    title: 'copland',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const p of ptys.values()) { try { p.kill(); } catch (_) {} }
  ptys.clear();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('pty:spawn', (event, cols, rows) => {
  const id = nextId++;
  const shell = process.env.SHELL || '/bin/bash';
  const p = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: os.homedir(),
    env: process.env,
  });
  const wc = () => BrowserWindow.fromWebContents(event.sender)?.webContents;
  p.onData((data) => { wc()?.send('pty:data', id, data); });
  p.onExit(() => { wc()?.send('pty:exit', id); ptys.delete(id); });
  ptys.set(id, p);
  return id;
});

ipcMain.on('pty:write', (event, id, data) => { ptys.get(id)?.write(data); });
ipcMain.on('pty:resize', (event, id, cols, rows) => {
  try { ptys.get(id)?.resize(Math.max(cols, 1), Math.max(rows, 1)); } catch (_) {}
});
ipcMain.on('pty:kill', (event, id) => {
  try { ptys.get(id)?.kill(); } catch (_) {}
  ptys.delete(id);
});

// keybind config: read from disk in main, handed to the renderer over IPC.
// (fetch() from file:// is unreliable; this never is.)
ipcMain.handle('config:keybinds', () => {
  const fs = require('fs');
  const p = path.join(__dirname, 'config', 'keybinds.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn('copland: could not read config/keybinds.json', e.message);
    return {
      leader: { key: ' ', modifiers: ['alt'] },
      leaderTimeoutMs: 1500,
      bindings: {},
    };
  }
});
