# ClaudeDeck

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that brings a chat interface with Claude AI straight into SteamOS Game Mode. It talks to the `claude` CLI already installed on the device, so conversations, tool use, and streaming all run locally on your Steam Deck.

> Chat with Claude without leaving Game Mode — ask for game guides, mods, cheats, emulator setup, or general SteamOS administration.

## Why ClaudeDeck?

The Steam Deck is a fantastic handheld, but the moment you need help you have to
drop out of Game Mode, reach for a phone or laptop, and break the flow. The
whole point of ClaudeDeck is to keep help *on the device*, one button away, while
you're still playing.

It was built to scratch a few very concrete itches:

- **Tips & tricks on demand** — you just started a new game and want the early-game
  do's and don'ts, a build recommendation, or "what should I not miss in the first
  hour?" — without alt-tabbing to a wiki.
- **Get unstuck fast** — you're stuck on a boss, a puzzle, or a cryptic quest.
  Ask right where you are and get a targeted answer instead of scrubbing through a
  20-minute video. The plugin already knows which game is running, so you don't
  even have to name it.
- **Fix games that won't launch** — a game crashes on boot or a non-Steam shortcut
  refuses to start. Because the backend runs a real `claude` CLI *on the Deck*, it
  can actually investigate: read Proton logs, check compat data, inspect
  `shortcuts.vdf`, try `WINEDLLOVERRIDES` tweaks — and fix it, not just describe a
  fix from a forum post.
- **SteamOS administration without SSH** — install a package, poke at a systemd
  service, unlock the read-only rootfs, set up a flatpak or distrobox container —
  all from the couch, no second machine required.
- **Emulator & artwork setup** — get EmuDeck, RetroArch, or a standalone emulator
  configured, sort out ROM folders, or grab SteamGridDB artwork for your library.
- **Mods, cheats & trainers** — find and install mods (Nexus, Workshop), or dig up
  console commands, config tweaks, and trainers for single-player runs.
- **Translate & explain** — decode an import-only game's menus, or get a mechanic
  or item description explained in plain language mid-session.
- **A general assistant that happens to live on your Deck** — quick questions,
  lookups, or math while you game, without picking up another device.

The recurring theme: Claude isn't just a chatbot here — it has hands on the actual
system, so it can *do* the thing, not only tell you how.

## Features

- **Chat in Game Mode** — full conversation UI rendered inside Steam's CEF browser, reachable from the Quick Access Menu.
- **Streaming responses** — assistant text, extended thinking, and tool calls stream in live as Claude works.
- **Conversation history** — create, browse, resume, and delete conversations. Sessions continue via the CLI's `--resume`.
- **Markdown + images** — replies render as Markdown; image URLs are proxied to data URIs so they display through Steam's strict CSP.
- **Game-aware context** — the currently running game is passed to Claude for more relevant guides and troubleshooting.
- **Configurable** — set the `claude` CLI path and an optional HTTP proxy from the settings tab.

## Requirements

- A Steam Deck (or other SteamOS device) with [Decky Loader](https://decky.xyz/) installed.
- The `claude` CLI installed and authenticated on the device, reachable from the plugin's `PATH` or configured explicitly in settings.

## Installing the Claude CLI on Steam Deck

SteamOS has a **read-only root filesystem that is wiped on every system update**,
so anything installed into `/usr` (including a global `npm` package) disappears
after the next update. The trick is to install the CLI **into your home
directory** (`~/.local/`), which is on a persistent partition and survives
updates. No need to unlock the rootfs.

Everything below is done in a terminal — either in **Desktop Mode** (Konsole) or
over SSH.

### Option A — native installer (recommended)

The official installer drops a self-contained binary into `~/.local/bin`, which
already survives updates:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Make sure `~/.local/bin` is on your `PATH` (it usually is; add this to
`~/.bashrc` if `claude` isn't found):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

> The plugin's backend already prepends `~/.local/bin` to the `PATH` it uses to
> launch the CLI, so a binary there is found even if your login shell wouldn't.

### Option B — npm into your home directory

If you prefer npm, point its global prefix at `~/.local` so packages land on the
persistent partition instead of the read-only rootfs. You still need `node`/`npm`
available — install them per-user (e.g. via [`nvm`](https://github.com/nvm-sh/nvm),
`fnm`, or a `distrobox` container) so they too survive updates:

```bash
npm config set prefix "$HOME/.local"
npm install -g @anthropic-ai/claude-code
```

### Authenticate

Run the CLI once interactively and follow the login flow:

```bash
claude
```

This stores your credentials under `~/.claude/` (persistent), so you only do it
once. Verify it works:

```bash
claude --version
claude -p "hello" --output-format json
```

### After a SteamOS update

Because everything lives in `~`, the CLI and your login **persist across
updates** — there is nothing to reinstall. If `claude` ever stops being found,
just re-check that `~/.local/bin` is on your `PATH`.

## Installation

### From source

```bash
pnpm install
pnpm build
```

Then copy the built plugin into Decky's plugin directory on the device:

```
~/homebrew/plugins/ClaudeDeck/
```

The plugin directory is owned by root, so files are typically staged in a temp
dir and moved with `sudo`, followed by a `plugin_loader` restart:

```bash
sudo systemctl restart plugin_loader.service
```

Open the Quick Access Menu (**⋯** button) in Game Mode and select ClaudeDeck.

## Configuration

Open the plugin's **Settings** tab:

- **Claude CLI path** — path or command name for the `claude` executable (defaults to `claude`).
- **HTTP proxy** — optional proxy for the CLI and image downloads, e.g. `http://192.168.1.100:3128`.

## Architecture

Python backend (runs inside Decky's `plugin_loader` service) + TypeScript/React frontend (rendered in Steam's CEF browser). They communicate over Decky RPC.

```
main.py                    # Plugin class — RPC methods, Claude CLI subprocess, image proxy
src/
  index.tsx                # Plugin registration, route, Quick Access Menu button
  components/
    ChatView.tsx           # Chat interface
    HistoryView.tsx        # Conversation list
    SettingsView.tsx       # Settings tab
  stores/
    chatStore.ts           # Zustand store — state + RPC calls
```

- **Backend** is Python 3.11, standard library only (Decky's `plugin_loader` provides no venv, and the SteamOS rootfs resets on updates).
- **Frontend** is React 18 with Zustand, built with Rollup, using `@decky/api` and `@decky/ui`.

## Development

```bash
# Frontend
pnpm install          # Install dependencies
pnpm build            # Rollup build to dist/
pnpm test             # Vitest
pnpm lint             # ESLint

# Backend
make test             # pytest
make lint             # ruff

# Full validation
pnpm build && pnpm test && pnpm lint && make test && make lint
```

All tests run without a real Steam Deck or Claude CLI — the `decky` module and the CLI subprocess are mocked.

## License

[MIT](LICENSE)
