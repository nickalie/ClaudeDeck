from __future__ import annotations

import asyncio
import base64
import functools
import json
import os
import re
import ssl
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(__file__))

import decky


class Plugin:
    def __init__(self) -> None:
        self._settings_dir = Path(decky.DECKY_PLUGIN_SETTINGS_DIR)
        self._conversations_dir = self._settings_dir / "conversations"
        self._settings_file = self._settings_dir / "settings.json"
        self._settings: dict[str, Any] = {}
        self._proc: subprocess.Popen[str] | None = None
        self._stopped = False
        self._stream_items: list[dict[str, Any]] = []
        self._stream_done = True
        self._stream_error: str | None = None
        self._stream_session_id: str | None = None
        self._stream_cost: float = 0
        self._stream_timed_out = False
        self._stderr_chunks: list[str] = []

    async def _run_sync(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, functools.partial(fn, *args, **kwargs))

    async def _main(self) -> None:
        self._settings_dir.mkdir(parents=True, exist_ok=True)
        self._conversations_dir.mkdir(parents=True, exist_ok=True)
        self._load_settings()
        decky.logger.info("ClaudeDeck backend ready")

    async def _unload(self) -> None:
        decky.logger.info("ClaudeDeck backend unloaded")

    async def _migration(self) -> None:
        pass

    # --- Settings ---

    def _get_defaults(self) -> dict[str, Any]:
        return {
            "claude_path": "claude",
            "http_proxy": "",
        }

    def _load_settings(self) -> None:
        defaults = self._get_defaults()
        if self._settings_file.exists():
            try:
                loaded = json.loads(self._settings_file.read_text())
                # Merge over defaults so keys added in newer releases are
                # always present, even for settings.json written by an
                # older version of the plugin.
                self._settings = {**defaults, **loaded}
            except (json.JSONDecodeError, OSError) as e:
                decky.logger.error(f"Failed to load settings: {e}")
                self._settings = defaults
        else:
            self._settings = defaults
            self._save_settings_sync()

    def _save_settings_sync(self) -> None:
        try:
            self._settings_file.write_text(json.dumps(self._settings, indent=2))
        except OSError as e:
            decky.logger.error(f"Failed to save settings: {e}")

    async def get_settings(self) -> dict[str, Any]:
        return self._settings

    async def save_settings(self, settings_json: str) -> dict[str, str]:
        try:
            new_settings = json.loads(settings_json)
        except (json.JSONDecodeError, TypeError) as e:
            return {"status": "error", "message": f"Invalid JSON: {e}"}
        if not isinstance(new_settings, dict):
            return {"status": "error", "message": "Settings must be an object"}
        # Merge over defaults so unknown-to-the-caller keys keep their
        # default instead of vanishing on save.
        self._settings = {**self._get_defaults(), **new_settings}
        self._save_settings_sync()
        return {"status": "ok"}

    # --- Conversation persistence ---

    def _conv_path(self, conv_id: str) -> Path:
        safe_id = conv_id.replace("/", "").replace("..", "")
        return self._conversations_dir / f"{safe_id}.json"

    def _read_conv(self, conv_id: str) -> dict[str, Any] | None:
        path = self._conv_path(conv_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def _write_conv(self, conv: dict[str, Any]) -> None:
        path = self._conv_path(conv["id"])
        try:
            path.write_text(json.dumps(conv, indent=2, ensure_ascii=False))
        except OSError as e:
            decky.logger.error(f"Failed to save conversation: {e}")

    # --- Conversation RPC ---

    async def create_conversation(self) -> dict[str, Any]:
        conv_id = uuid.uuid4().hex[:8]
        now = int(time.time())
        conv: dict[str, Any] = {
            "id": conv_id,
            "title": "New chat",
            "session_id": None,
            "messages": [],
            "created_at": now,
            "updated_at": now,
        }
        self._write_conv(conv)
        return {"status": "ok", "conversation": conv}

    async def get_conversations(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for path in self._conversations_dir.glob("*.json"):
            try:
                conv = json.loads(path.read_text())
                results.append({
                    "id": conv["id"],
                    "title": conv.get("title", "Untitled"),
                    "message_count": len(conv.get("messages", [])),
                    "updated_at": conv.get("updated_at", 0),
                })
            except (json.JSONDecodeError, OSError, KeyError):
                continue
        results.sort(key=lambda c: c["updated_at"], reverse=True)
        return results

    async def load_conversation(self, conversation_id: str) -> dict[str, Any]:
        conv = self._read_conv(conversation_id)
        if conv is None:
            return {"status": "error", "message": "Conversation not found"}
        return {"status": "ok", "conversation": conv}

    async def delete_conversation(self, conversation_id: str) -> dict[str, str]:
        path = self._conv_path(conversation_id)
        if path.exists():
            try:
                path.unlink()
            except OSError as e:
                return {"status": "error", "message": str(e)}
        return {"status": "ok"}

    # --- Claude CLI interaction ---

    _SYSTEM_PROMPT = (
        "You are an AI assistant running on a Steam Deck under SteamOS. "
        "You are launched as a Decky Loader plugin directly in Game Mode.\n\n"
        "Your responsibilities:\n"
        "- Administer SteamOS: package management, systemd services, networking, "
        "readonly rootfs (steamos-readonly disable/enable), flatpak, distrobox\n"
        "- Manage Steam: client settings, Non-Steam shortcuts, "
        "Proton compatibility, troubleshooting game launch issues\n"
        "- Help with games: find walkthroughs, guides, tips, "
        "and solutions to in-game problems online\n"
        "- Install and configure game mods "
        "(Nexus Mods, Steam Workshop, manual installation)\n"
        "- Help with cheats and trainers: WeMod, CheatEngine, "
        "console commands, game config tweaks\n"
        "- Set up emulators: EmuDeck, RetroArch, standalone emulators, "
        "ROM Manager, SteamGridDB for artwork\n\n"
        "The chat interface renders full Markdown including images. "
        "When helpful, include images using ![description](url) syntax — "
        "for example, game maps, guide screenshots, or reference images.\n\n"
        "Always reply in the same language the user writes in. "
        "Be concise and specific — the user is on a small Steam Deck screen."
    )

    def _build_system_prompt(self, running_game: str) -> str:
        if running_game:
            return (
                self._SYSTEM_PROMPT
                + f"\n\nThe user is currently playing: {running_game}. "
                "Use this context when answering game-related questions "
                "(guides, mods, cheats, troubleshooting, etc.)."
            )
        return self._SYSTEM_PROMPT

    def _build_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env["LANG"] = "en_US.UTF-8"
        local_bin = "/home/deck/.local/bin"
        if local_bin not in env.get("PATH", ""):
            env["PATH"] = local_bin + ":" + env.get("PATH", "/usr/bin")
        env.pop("LD_LIBRARY_PATH", None)
        env.pop("LD_PRELOAD", None)
        proxy = self._settings.get("http_proxy", "")
        if proxy:
            for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
                env[key] = proxy
        return env

    # Hard upper bound on a single generation (seconds). Guarantees the
    # stream thread cannot hang forever if the CLI stalls or never sends EOF.
    _STREAM_TIMEOUT = 300

    def _stream_claude(
        self, message: str, session_id: str | None,
        running_game: str, conv_id: str,
    ) -> None:
        """Stream claude CLI output. Runs in executor thread."""
        claude_path = self._settings.get("claude_path", "claude")
        cmd = [
            claude_path, "-p", message,
            "--output-format", "stream-json", "--verbose",
            "--system-prompt", self._build_system_prompt(running_game),
            "--dangerously-skip-permissions",
        ]

        if session_id:
            cmd.extend(["--resume", session_id])

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=self._build_env(),
            )
        except FileNotFoundError:
            self._stream_error = f"Claude CLI not found: {claude_path}"
            self._stream_done = True
            return

        self._proc = proc

        # Drain stderr concurrently so a chatty --verbose run cannot fill the
        # pipe buffer and deadlock the stdout reader.
        self._stderr_chunks = []
        stderr_thread = threading.Thread(
            target=self._drain_stderr, args=(proc,), daemon=True,
        )
        stderr_thread.start()

        # Watchdog: terminate the process if it exceeds the time budget.
        timer = threading.Timer(self._STREAM_TIMEOUT, self._on_timeout, args=(proc,))
        timer.daemon = True
        timer.start()

        try:
            self._consume_stream(proc, conv_id, stderr_thread)
        except Exception as e:
            if not self._stopped:
                decky.logger.error(f"Stream error: {e}")
                self._stream_error = str(e)
        finally:
            timer.cancel()
            self._proc = None
            self._stream_done = True

    def _drain_stderr(self, proc: subprocess.Popen[str]) -> None:
        try:
            if proc.stderr:
                for line in proc.stderr:
                    self._stderr_chunks.append(line)
        except Exception:
            pass

    def _on_timeout(self, proc: subprocess.Popen[str]) -> None:
        if proc.poll() is None:
            self._stream_timed_out = True
            try:
                proc.terminate()
            except Exception:
                pass

    def _consume_stream(
        self, proc: subprocess.Popen[str], conv_id: str,
        stderr_thread: threading.Thread | None = None,
    ) -> None:
        for line in proc.stdout or []:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            self._process_event(event)

        proc.wait()
        if stderr_thread:
            stderr_thread.join(timeout=2)

        if self._stopped:
            return

        if not self._stream_items:
            self._stream_error = self._stream_failure_reason(proc.returncode)
            return

        self._finalize_stream(conv_id)

    def _stream_failure_reason(self, returncode: int | None) -> str:
        """Explain why a stream produced no items (never blank silence)."""
        if self._stream_timed_out:
            return "Claude CLI timed out"
        stderr = "".join(self._stderr_chunks).strip()
        if returncode:
            return stderr or f"Claude CLI exited with code {returncode}"
        return stderr or "Empty response from Claude CLI"

    def _process_event(self, event: dict[str, Any]) -> None:
        """Parse a stream-json event into one or more stream items."""
        etype = event.get("type", "")
        if etype == "assistant":
            content = event.get("message", {}).get("content", [])
            for block in content:
                if isinstance(block, dict):
                    self._add_assistant_block(block)
        elif etype == "user":
            content = event.get("message", {}).get("content", [])
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    self._add_tool_result_block(block)
        elif etype == "result":
            self._stream_session_id = event.get("session_id")
            self._stream_cost = event.get("total_cost_usd", 0)

    def _add_assistant_block(self, block: dict[str, Any]) -> None:
        btype = block.get("type")
        if btype == "text":
            text = block.get("text", "")
            if text:
                # Resolve external image URLs to data URIs while still
                # streaming, so the live view (which never reloads the
                # conversation) shows images that Steam's CEF would block.
                if "![" in text:
                    text = self._resolve_images(text)
                self._stream_items.append({"type": "text", "content": text})
        elif btype == "thinking":
            thinking = block.get("thinking", "")
            if thinking:
                self._stream_items.append(
                    {"type": "thinking", "content": thinking},
                )
        elif btype == "tool_use":
            self._stream_items.append({
                "type": "tool_use",
                "tool_name": block.get("name", ""),
                "tool_input": block.get("input", {}),
                "tool_use_id": block.get("id", ""),
            })

    def _add_tool_result_block(self, block: dict[str, Any]) -> None:
        self._stream_items.append({
            "type": "tool_result",
            "content": self._flatten_tool_result(block.get("content", "")),
            "is_error": bool(block.get("is_error")),
            "tool_use_id": block.get("tool_use_id", ""),
        })

    @staticmethod
    def _flatten_tool_result(raw: Any) -> str:
        if isinstance(raw, str):
            return raw
        if isinstance(raw, list):
            parts: list[str] = []
            for p in raw:
                if isinstance(p, dict) and p.get("type") == "text":
                    parts.append(p.get("text", ""))
                elif isinstance(p, str):
                    parts.append(p)
            return "".join(parts)
        return str(raw)

    _MSG_KEYS = ("tool_name", "tool_input", "tool_use_id")

    @classmethod
    def _item_to_message(cls, item: dict[str, Any], ts: int) -> dict[str, Any]:
        msg: dict[str, Any] = {
            "role": "assistant",
            "content": item.get("content", ""),
            "timestamp": ts,
            "item_type": item["type"],
        }
        for key in cls._MSG_KEYS:
            if key in item:
                msg[key] = item[key]
        if item.get("is_error"):
            msg["is_error"] = True
        return msg

    def _finalize_stream(self, conv_id: str) -> None:
        """Save streamed items as separate messages in the conversation.

        Image URLs are already resolved to data URIs during streaming
        (see _add_assistant_block), so finalization stays non-blocking.
        """
        conv = self._read_conv(conv_id)
        if not conv or not self._stream_items:
            return

        if self._stream_session_id:
            conv["session_id"] = self._stream_session_id

        now = int(time.time())
        for item in self._stream_items:
            conv["messages"].append(self._item_to_message(item, now))
        conv["updated_at"] = now
        self._write_conv(conv)

    async def send_message(self, conversation_id: str,
                           message: str,
                           running_game: str = "") -> dict[str, Any]:
        """Start streaming a response in a conversation."""
        if self._proc is not None:
            return {"status": "error", "message": "Already generating a response"}

        conv = self._read_conv(conversation_id)
        if conv is None:
            return {"status": "error", "message": "Conversation not found"}

        now = int(time.time())

        conv["messages"].append({
            "role": "user",
            "content": message,
            "timestamp": now,
        })

        if sum(1 for m in conv["messages"] if m["role"] == "user") == 1:
            conv["title"] = message[:60].rstrip() + ("..." if len(message) > 60 else "")

        conv["updated_at"] = now
        self._write_conv(conv)

        # Reset stream state
        self._stream_items = []
        self._stream_done = False
        self._stream_error = None
        self._stream_session_id = None
        self._stream_cost = 0
        self._stopped = False
        self._stream_timed_out = False
        self._stderr_chunks = []

        # Fire and forget — stream runs in background thread
        loop = asyncio.get_running_loop()
        loop.run_in_executor(
            None,
            self._stream_claude,
            message, conv.get("session_id"), running_game, conversation_id,
        )

        return {"status": "streaming"}

    async def get_stream(self) -> dict[str, Any]:
        """Poll current stream state."""
        return {
            "items": self._stream_items,
            "done": self._stream_done,
            "error": self._stream_error,
            "session_id": self._stream_session_id,
            "cost_usd": self._stream_cost,
        }

    async def stop_claude(self) -> dict[str, str]:
        """Terminate the running Claude CLI process."""
        self._stopped = True
        proc = self._proc
        if proc:
            proc.terminate()
        return {"status": "ok"}

    # --- Image proxy ---

    _IMG_RE = re.compile(r"!\[([^\]]*)\]\((https?://[^)]+)\)")

    def _fetch_data_uri(self, url: str) -> str | None:
        """Fetch a URL and return as data URI, or None on failure."""
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            handlers: list[urllib.request.BaseHandler] = [
                urllib.request.HTTPSHandler(context=ctx),
            ]
            proxy = self._settings.get("http_proxy", "")
            if proxy:
                handlers.append(urllib.request.ProxyHandler({
                    "http": proxy, "https": proxy,
                }))
            opener = urllib.request.build_opener(*handlers)
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0"},
            )
            with opener.open(req, timeout=15) as resp:
                ct = resp.headers.get("Content-Type", "image/png")
                data = resp.read(10 * 1024 * 1024)
                b64 = base64.b64encode(data).decode("ascii")
                return f"data:{ct};base64,{b64}"
        except Exception as e:
            decky.logger.warning(f"Image fetch failed {url}: {e}")
            return None

    def _resolve_images(self, text: str) -> str:
        """Replace markdown image URLs with proxied data URIs."""
        def replace(m: re.Match[str]) -> str:
            alt, url = m.group(1), m.group(2)
            data_uri = self._fetch_data_uri(url)
            if data_uri:
                return f"![{alt}]({data_uri})"
            return m.group(0)
        return self._IMG_RE.sub(replace, text)

    def _proxy_image(self, url: str) -> dict[str, Any]:
        data_uri = self._fetch_data_uri(url)
        if data_uri:
            return {"status": "ok", "data_uri": data_uri}
        raise RuntimeError(f"Failed to fetch {url}")

    async def proxy_image(self, url: str) -> dict[str, Any]:
        try:
            return await self._run_sync(self._proxy_image, url)
        except Exception as e:
            decky.logger.error(f"Image proxy error: {e}")
            return {"status": "error", "message": str(e)}

    async def ping(self) -> str:
        return "pong"
