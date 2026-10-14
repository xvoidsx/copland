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
  const wc = () => {
    // fromWebContents THROWS on a destroyed webContents (e.g. the pty
    // emits during window teardown) — optional chaining can't catch that.
    try {
      if (event.sender.isDestroyed()) return undefined;
      return BrowserWindow.fromWebContents(event.sender)?.webContents;
    } catch (_) { return undefined; }
  };
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

// keybind config: ~/.config/copland/keybinds.json wins when present (the
// tmux.conf equivalent), otherwise the bundled default. read from disk in
// main and handed to the renderer over IPC — fetch() from file:// is
// unreliable, this never is.
ipcMain.handle('config:keybinds', () => {
  const fs = require('fs');
  const userPath = path.join(os.homedir(), '.config', 'copland', 'keybinds.json');
  const bundled = path.join(__dirname, 'config', 'keybinds.json');
  const fallback = {
    leader: { key: ' ', modifiers: ['alt'] },
    leaderTimeoutMs: 1500,
    bindings: {},
  };
  try {
    const base = JSON.parse(fs.readFileSync(bundled, 'utf8'));
    // merge, don't replace: a user config from an older version lacks
    // bindings added since (e.g. Shift+Arrow swap, Ctrl+Arrow resize).
    // bundled defaults fill the gaps; user keys win on conflict.
    if (fs.existsSync(userPath)) {
      const user = JSON.parse(fs.readFileSync(userPath, 'utf8'));
      return {
        ...base,
        ...user,
        leader: { ...base.leader, ...(user.leader || {}) },
        bindings: { ...base.bindings, ...(user.bindings || {}) },
      };
    }
    return base;
  } catch (e) {
    console.warn('copland: could not read keybinds config', e.message);
    return fallback;
  }
});
