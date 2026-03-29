# CLAUDE.md

## Project Purpose

ClaudeDeck is a Decky Loader plugin for Steam Deck (SteamOS). It provides a chat interface with Claude AI directly from Game Mode, using the `claude` CLI that is already installed on the system.

## Architecture

Python backend (runs in Decky's plugin_loader service) + TypeScript/React frontend (rendered inside Steam's CEF browser).

Communication: Decky RPC — frontend calls `callable<[Args], ReturnType>("method_name")`, backend exposes `async def method_name(self, ...)` methods on the Plugin class.

### Backend (Python 3.11, stdlib only)

```
main.py                        # Plugin class — Decky entry point, RPC methods
```

Key functionality:
- Conversation CRUD (create, list, load, delete) — stored as JSON files in Decky settings dir
- Message sending via `claude -p "message" --output-format json` subprocess call
- Session continuity via `--resume SESSION_ID` flag for ongoing conversations
- Settings management (claude CLI path)

### Frontend (TypeScript, React 18, Zustand)

```
src/
  index.tsx                    # Entry point — plugin registration, route, QAM button
  components/
    ChatView.tsx               # Chat interface — message bubbles, input field, auto-scroll
    HistoryView.tsx            # Conversation list — open, create, delete conversations
  stores/
    chatStore.ts               # Zustand store — all state, RPC calls, tab navigation
```

### State Management

All frontend state is in a single Zustand store (`chatStore`). Components are thin UI layers that subscribe via selectors:
```ts
const messages = useChatStore(s => s.messages);
```

## Build, Test, Lint

```bash
# Frontend
pnpm install          # Install dependencies
pnpm build            # Rollup build to dist/
pnpm test             # Vitest (single run)
pnpm lint             # ESLint src/

# Backend
make test             # python -m pytest tests/ -v
make lint             # ruff check .

# Full validation
pnpm build && pnpm test && pnpm lint && make test && make lint
```

## Linter Rules

- Ruff (Python): E, F, W, C901 (complexity <= 8), I (isort). Config in pyproject.toml.
- ESLint 9 (TypeScript): complexity <= 8, max-depth <= 3. Flat config in eslint.config.js.

## Key Constraints

- Python backend uses stdlib only (no pip packages) — Decky plugin_loader provides no venv, and rootfs resets on SteamOS updates
- Frontend depends on @decky/api and @decky/ui which provide React, router, and Steam UI components
- Decky API contract: Plugin class must have `_main()` (init) and `_unload()` (cleanup) methods. RPC methods are public async methods on Plugin
- SteamOS immutable rootfs: plugin files live in ~/homebrew/plugins/ (user space, survives updates)
- Settings persist in Decky's plugin settings dir (not in the plugin folder itself)
- `claude` CLI must be in PATH or configured via settings — called as subprocess with `--output-format json`
- Conversation history is stored in JSON files under `DECKY_PLUGIN_SETTINGS_DIR/conversations/`

## Testing

- Python: pytest, tests in tests/. conftest.py patches decky module for import resolution outside SteamOS. subprocess.run is mocked for Claude CLI tests.
- TypeScript: vitest, test files colocated with stores (*.test.ts). @decky/api is mocked.
- All tests run without a real Steam Deck or Claude CLI — everything is mocked.

## Deployment

Plugin directory on Deck is owned by root, so files must be copied via temp dir then moved with sudo.

```bash
# 1. Rsync to temp dir (exclude dev-only files)
rsync -avz \
  --exclude='node_modules' --exclude='.git' --exclude='tests' \
  --exclude='src' --exclude='.pytest_cache' --exclude='__pycache__' \
  --exclude='.rollup.cache' --exclude='.vscode' \
  --exclude='*.test.*' --exclude='.gitignore' --exclude='tsconfig.json' \
  --exclude='rollup.config.js' --exclude='eslint.config.js' \
  --exclude='pnpm-lock.yaml' --exclude='Makefile' --exclude='pyproject.toml' \
  --exclude='CLAUDE.md' --exclude='.claude' --exclude='.ruff_cache' \
  -e 'ssh -o StrictHostKeyChecking=no' \
  /home/nick/develop/projects/my/steamos/ClaudeDeck/ \
  deck@steamdeck:/tmp/ClaudeDeck_deploy/

# 2. Copy to plugin dir with sudo and restart
ssh deck@steamdeck \
  "sudo cp -r /tmp/ClaudeDeck_deploy/* ~/homebrew/plugins/ClaudeDeck/ && \
   sudo systemctl restart plugin_loader.service && \
   rm -rf /tmp/ClaudeDeck_deploy"

# 3. Verify
ssh deck@steamdeck \
  "sudo cat \"\$(ls -dt ~/homebrew/logs/ClaudeDeck/*.log | head -1)\""
# Should show: "ClaudeDeck backend ready"
```

### Decky Sandbox Caveat

Decky's `sandboxed_plugin.py` does NOT add the plugin directory to `sys.path`. The `sys.path.insert(0, os.path.dirname(__file__))` at the top of `main.py` is required for any `from backend.xxx import ...` imports to work. Do not remove it.
