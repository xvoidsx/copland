# copland

A beautiful Electron + WebGL terminal for navi — panes, nightshadeNeon, and
navi's keybind soul. If it earns it, copland becomes navi's default terminal.

## The idea

The terminal emulator is one of the last pieces of the visible stack xvoidsx
doesn't own. copland is the experiment to change that: xterm.js (proven —
it's what VS Code's terminal runs on) with its GPU-backed WebGL renderer,
node-pty for shells, and an Electron shell that brings panes, a config-driven
leader key, and the nightshadeNeon aesthetic.

## Demo status

`v0.1.0-demo`: launches, one shell, panes (split horizontal/vertical,
directional focus, kill, zoom), leader key (default **Alt+Space** —
configurable in `config/keybinds.json`), nightshadeNeon throughout.

Leader never collides with tmux/herdr's Ctrl+Space — copland nests those
regularly.

## Run it

```bash
npm install   # builds node-pty
npm start
```

Leader, then:
| keys | action |
| ---- | ------ |
| `h` / `v` | split horizontal / vertical |
| arrows | move focus between panes |
| `o` | cycle focus to next pane |
| `Shift`+arrows | resize the focused pane |
| `{` / `}` | swap focused pane with prev / next |
| `x` | kill focused pane |
| `z` | zoom focused pane |

Keybinds live in `config/keybinds.json`; `~/.config/copland/keybinds.json`
overrides them per-user (the tmux.conf equivalent).

## Stack

Electron 30 · xterm.js + WebGL addon · node-pty · no bundler (UMD scripts).

See [AGENTS.md](AGENTS.md) for the agent operating manual.

## License

GPL-3.0-only. © xvoidsx.
