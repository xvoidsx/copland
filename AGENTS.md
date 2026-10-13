# AGENTS.md — copland

Agent operating manual for this repo. xvoidsx convention: every repo carries
one so any agent — main Lain, sibling Lains, future contributors — can work
here without guessing.

## What this is

copland is xvoidsx's terminal emulator: Electron + xterm.js (WebGL
renderer) + node-pty. The demo goal is a beautiful, lightweight,
nightshadeNeon terminal with panes and navi-style keybinds. If it earns it,
copland becomes navi's default terminal.

## Stack (pinned — do not bump casually)

- Electron 30 / electron-builder 24 (pinned per the navi native-app CI
  lessons: never set GH_TOKEN on the electron-builder build step; `files.from`
  must be a directory; always commit package-lock.json)
- `@xterm/xterm` + `@xterm/addon-webgl` + `@xterm/addon-fit` (UMD bundles
  loaded via `<script>` in renderer/index.html — no bundler in the demo)
- `node-pty` for PTYs (native module; builds at `npm install`)

## Architecture

- `main.js` owns every PTY. The renderer never touches node-pty.
- `preload.js` exposes exactly one API: `window.copland`
  (spawnPty/writePty/resizePty/killPty, onPtyData/onPtyExit, loadKeybinds).
  Context isolation stays on; nodeIntegration stays off.
- `renderer/` holds the UI. Panes are a tiny tree (leaves + splits)
  rendered as nested flexbox; see renderer.js.
- Keybinds live in `config/keybinds.json` — the leader and all bindings.
  **Never hardcode the leader in renderer.js.**

## Conventions

- **Theme source of truth:** `renderer/theme.js` (terminal cells) and
  `renderer/styles.css` (window chrome) carry the nightshadeNeon palette:
  pink `#ff10f0`, green `#39ff14`, cyan `#00ffff`, red `#ff3131`,
  obsidian `#0a050b`. Same hues as navi's waybar theme.
- **Glow is cheap CSS** (`box-shadow`), never per-frame canvas work.
  Lightness is a feature — this aims to be navi's default terminal.
- **Leader key:** default Alt+Space (configurable). It must never collide
  with tmux/herdr's Ctrl+Space — copland nests those regularly.
- **Commits:** push as `lainVII[bot]` per xvoidsx convention.

## Running the demo

```bash
npm install   # builds node-pty
npm start
```

## Roadmap (not yet — demo first)

- navi mods integration (the dream: mods render beautifully here)
- profiles, tabs, session restore
- `.deb` packaging via electron-builder (gzip, never zstd)
