"""Tests for ClaudeDeck plugin scaffolding and backend."""

import asyncio
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from conftest import import_plugin, make_plugin

ROOT = Path(__file__).resolve().parent.parent


class TestProjectFiles:
    def test_plugin_json_exists_and_valid(self) -> None:
        path = ROOT / "plugin.json"
        assert path.exists()
        data = json.loads(path.read_text())
        assert data["name"] == "ClaudeDeck"
        assert data["api_version"] == 1
        assert "author" in data

    def test_package_json_exists_and_valid(self) -> None:
        path = ROOT / "package.json"
        assert path.exists()
        data = json.loads(path.read_text())
        assert data["name"] == "claudedeck"
        assert "@decky/api" in data["dependencies"]
        assert "@decky/ui" in data["devDependencies"]
        assert "@decky/rollup" in data["devDependencies"]
        assert "build" in data["scripts"]

    def test_tsconfig_json_exists_and_valid(self) -> None:
        path = ROOT / "tsconfig.json"
        assert path.exists()
        data = json.loads(path.read_text())
        opts = data["compilerOptions"]
        assert opts["target"] == "ES2020"
        assert opts["module"] == "ESNext"
        assert opts["jsx"] == "react"
        assert "SP_REACT" in opts["jsxFactory"]

    def test_rollup_config_exists(self) -> None:
        path = ROOT / "rollup.config.js"
        assert path.exists()
        content = path.read_text()
        assert "@decky/rollup" in content

    def test_index_tsx_exists(self) -> None:
        path = ROOT / "src" / "index.tsx"
        assert path.exists()
        content = path.read_text()
        assert "definePlugin" in content
        assert "ClaudeDeck" in content

    def test_main_py_exists(self) -> None:
        path = ROOT / "main.py"
        assert path.exists()
        content = path.read_text()
        assert "class Plugin" in content
        assert "_main" in content
        assert "_unload" in content
        assert "_migration" in content


class TestPluginBackend:
    def test_plugin_class_exists(self) -> None:
        mod = import_plugin()
        plugin = mod.Plugin()
        assert hasattr(plugin, "_main")
        assert hasattr(plugin, "_unload")
        assert hasattr(plugin, "_migration")

    def test_plugin_main_creates_settings(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = mod.Plugin()
        asyncio.run(plugin._main())
        settings_file = tmp_settings / "settings.json"
        assert settings_file.exists()
        data = json.loads(settings_file.read_text())
        assert "claude_path" in data

    def test_plugin_main_creates_conversations_dir(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = mod.Plugin()
        asyncio.run(plugin._main())
        conv_dir = tmp_settings / "conversations"
        assert conv_dir.is_dir()

    def test_plugin_loads_existing_settings(self, tmp_settings: Path) -> None:
        custom = {"claude_path": "/usr/local/bin/claude"}
        (tmp_settings / "settings.json").write_text(json.dumps(custom))
        mod = import_plugin()
        plugin = mod.Plugin()
        asyncio.run(plugin._main())
        assert plugin._settings["claude_path"] == "/usr/local/bin/claude"

    def test_plugin_get_settings_rpc(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = mod.Plugin()
        asyncio.run(plugin._main())
        result = asyncio.run(plugin.get_settings())
        assert "claude_path" in result

    def test_plugin_save_settings_rpc(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = mod.Plugin()
        asyncio.run(plugin._main())
        new_settings = json.dumps({"claude_path": "/opt/claude"})
        result = asyncio.run(plugin.save_settings(new_settings))
        assert result["status"] == "ok"
        assert plugin._settings["claude_path"] == "/opt/claude"

    def test_plugin_save_settings_invalid_json(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = mod.Plugin()
        asyncio.run(plugin._main())
        result = asyncio.run(plugin.save_settings("not json"))
        assert result["status"] == "error"

    def test_plugin_ping_rpc(self) -> None:
        mod = import_plugin()
        plugin = mod.Plugin()
        result = asyncio.run(plugin.ping())
        assert result == "pong"

    def test_plugin_unload(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = mod.Plugin()
        asyncio.run(plugin._main())
        asyncio.run(plugin._unload())

    def test_plugin_migration(self) -> None:
        mod = import_plugin()
        plugin = mod.Plugin()
        asyncio.run(plugin._migration())


class TestConversationCRUD:
    def test_create_conversation(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        result = asyncio.run(plugin.create_conversation())
        assert result["status"] == "ok"
        conv = result["conversation"]
        assert "id" in conv
        assert conv["title"] == "Новый чат"
        assert conv["messages"] == []
        assert conv["session_id"] is None

    def test_get_conversations_empty(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        result = asyncio.run(plugin.get_conversations())
        assert result == []

    def test_get_conversations_returns_list(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        asyncio.run(plugin.create_conversation())
        asyncio.run(plugin.create_conversation())

        result = asyncio.run(plugin.get_conversations())
        assert len(result) == 2
        assert "id" in result[0]
        assert "title" in result[0]
        assert "message_count" in result[0]

    def test_load_conversation(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        result = asyncio.run(plugin.load_conversation(conv_id))
        assert result["status"] == "ok"
        assert result["conversation"]["id"] == conv_id

    def test_load_conversation_not_found(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        result = asyncio.run(plugin.load_conversation("nonexistent"))
        assert result["status"] == "error"

    def test_delete_conversation(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        result = asyncio.run(plugin.delete_conversation(conv_id))
        assert result["status"] == "ok"

        result = asyncio.run(plugin.load_conversation(conv_id))
        assert result["status"] == "error"

    def test_conv_id_sanitization(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        # Path traversal attempt should be sanitized
        path = plugin._conv_path("../../etc/passwd")
        assert ".." not in str(path.name)


class TestSendMessage:
    def test_send_message_conversation_not_found(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        result = asyncio.run(plugin.send_message("nonexistent", "hello"))
        assert result["status"] == "error"

    def test_send_message_success(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        mock_output = json.dumps({
            "result": "Hello! How can I help?",
            "session_id": "sess_123",
            "cost_usd": 0.001,
        })
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = mock_output
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            result = asyncio.run(plugin.send_message(conv_id, "Hello"))

        assert result["status"] == "ok"
        assert result["response"] == "Hello! How can I help?"
        assert result["session_id"] == "sess_123"

        # Verify conversation was updated
        conv = plugin._read_conv(conv_id)
        assert len(conv["messages"]) == 2
        assert conv["messages"][0]["role"] == "user"
        assert conv["messages"][0]["content"] == "Hello"
        assert conv["messages"][1]["role"] == "assistant"
        assert conv["session_id"] == "sess_123"
        assert conv["title"] == "Hello"

    def test_send_message_uses_resume(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]
        conv = plugin._read_conv(conv_id)
        conv["session_id"] = "existing_session"
        plugin._write_conv(conv)

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({"result": "ok", "session_id": "existing_session"})
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            asyncio.run(plugin.send_message(conv_id, "test"))

        call_args = mock_run.call_args[0][0]
        assert "--resume" in call_args
        assert "existing_session" in call_args

    def test_send_message_cli_not_found(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        with patch("subprocess.run", side_effect=FileNotFoundError("claude not found")):
            result = asyncio.run(plugin.send_message(conv_id, "Hello"))

        assert result["status"] == "error"
        assert "не найден" in result["message"]

    def test_send_message_timeout(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        import subprocess as sp
        with patch("subprocess.run", side_effect=sp.TimeoutExpired("claude", 300)):
            result = asyncio.run(plugin.send_message(conv_id, "Hello"))

        assert result["status"] == "error"
        assert "5 минут" in result["message"]

    def test_send_message_cli_error(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "Authentication failed"

        with patch("subprocess.run", return_value=mock_result):
            result = asyncio.run(plugin.send_message(conv_id, "Hello"))

        assert result["status"] == "error"

    def test_send_message_saves_user_message_on_error(self, tmp_settings: Path) -> None:
        """User message should be saved even if Claude CLI fails."""
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        with patch("subprocess.run", side_effect=FileNotFoundError()):
            asyncio.run(plugin.send_message(conv_id, "My important question"))

        conv = plugin._read_conv(conv_id)
        assert len(conv["messages"]) == 1
        assert conv["messages"][0]["content"] == "My important question"

    def test_send_message_plain_text_fallback(self, tmp_settings: Path) -> None:
        """If Claude CLI returns non-JSON, treat as plain text."""
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Just plain text response"
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            result = asyncio.run(plugin.send_message(conv_id, "Hello"))

        assert result["status"] == "ok"
        assert result["response"] == "Just plain text response"
