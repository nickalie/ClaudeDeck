from __future__ import annotations

import asyncio
import functools
import json
import os
import subprocess
import sys
import time
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
            "claude_path": "claudep",
        }

    def _load_settings(self) -> None:
        if self._settings_file.exists():
            try:
                self._settings = json.loads(self._settings_file.read_text())
            except (json.JSONDecodeError, OSError) as e:
                decky.logger.error(f"Failed to load settings: {e}")
                self._settings = self._get_defaults()
        else:
            self._settings = self._get_defaults()
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
        self._settings = new_settings
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
            "title": "Новый чат",
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
                    "title": conv.get("title", "Без названия"),
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

    def _call_claude(self, message: str, session_id: str | None) -> dict[str, Any]:
        """Call claude CLI synchronously. Meant to be run in executor."""
        claude_path = self._settings.get("claude_path", "claude")
        cmd = [claude_path, "-p", message, "--output-format", "json", "--verbose"]

        if session_id:
            cmd.extend(["--resume", session_id])

        env = os.environ.copy()
        env["LANG"] = "en_US.UTF-8"

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            env=env,
        )

        if result.returncode != 0:
            stderr = result.stderr.strip()
            # claude CLI may print warnings to stderr but still succeed
            if not result.stdout.strip():
                raise RuntimeError(stderr or f"Claude CLI exited with code {result.returncode}")

        stdout = result.stdout.strip()
        if not stdout:
            raise RuntimeError("Empty response from Claude CLI")

        # Parse JSON output
        try:
            output = json.loads(stdout)
            return {
                "response": output.get("result", stdout),
                "session_id": output.get("session_id"),
                "cost_usd": output.get("cost_usd", 0),
            }
        except json.JSONDecodeError:
            # Fallback: treat as plain text
            return {
                "response": stdout,
                "session_id": None,
                "cost_usd": 0,
            }

    async def send_message(self, conversation_id: str,
                           message: str) -> dict[str, Any]:
        """Send a message in a conversation and return Claude's response."""
        conv = self._read_conv(conversation_id)
        if conv is None:
            return {"status": "error", "message": "Conversation not found"}

        now = int(time.time())

        # Add user message
        conv["messages"].append({
            "role": "user",
            "content": message,
            "timestamp": now,
        })

        # Update title from first user message
        if sum(1 for m in conv["messages"] if m["role"] == "user") == 1:
            conv["title"] = message[:60].rstrip() + ("..." if len(message) > 60 else "")

        # Save with user message before calling Claude (so it's not lost on error)
        conv["updated_at"] = now
        self._write_conv(conv)

        try:
            result = await self._run_sync(
                self._call_claude, message, conv.get("session_id"),
            )
        except subprocess.TimeoutExpired:
            return {"status": "error", "message": "Ответ Claude не получен за 5 минут"}
        except FileNotFoundError:
            claude_path = self._settings.get("claude_path", "claude")
            return {"status": "error",
                    "message": f"Claude CLI не найден: {claude_path}"}
        except Exception as e:
            decky.logger.error(f"Claude CLI error: {e}")
            return {"status": "error", "message": str(e)}

        response_text = result["response"]
        new_session_id = result.get("session_id")

        if new_session_id:
            conv["session_id"] = new_session_id

        conv["messages"].append({
            "role": "assistant",
            "content": response_text,
            "timestamp": int(time.time()),
        })
        conv["updated_at"] = int(time.time())
        self._write_conv(conv)

        return {
            "status": "ok",
            "response": response_text,
            "session_id": new_session_id,
            "cost_usd": result.get("cost_usd", 0),
        }

    async def ping(self) -> str:
        return "pong"
