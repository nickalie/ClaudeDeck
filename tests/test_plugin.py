"""Tests for ClaudeDeck plugin scaffolding and backend."""

import asyncio
import json
from pathlib import Path
from unittest.mock import MagicMock

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


def _make_plugin_with_stub_stream(mod, tmp_settings: Path):
    """Make plugin with _stream_claude patched out — prevents real CLI calls."""
    plugin = make_plugin(mod, tmp_settings)
    plugin._conversations_dir.mkdir(parents=True, exist_ok=True)
    plugin._stream_claude = MagicMock()  # type: ignore[method-assign]
    return plugin


class TestSendMessage:
    def test_send_message_conversation_not_found(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = _make_plugin_with_stub_stream(mod, tmp_settings)

        result = asyncio.run(plugin.send_message("nonexistent", "hello"))
        assert result["status"] == "error"

    def test_send_message_returns_streaming(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = _make_plugin_with_stub_stream(mod, tmp_settings)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        result = asyncio.run(plugin.send_message(conv_id, "Hello"))
        assert result["status"] == "streaming"

    def test_send_message_saves_user_message_and_sets_title(
        self, tmp_settings: Path,
    ) -> None:
        mod = import_plugin()
        plugin = _make_plugin_with_stub_stream(mod, tmp_settings)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        asyncio.run(plugin.send_message(conv_id, "My first question"))

        conv = plugin._read_conv(conv_id)
        assert len(conv["messages"]) == 1
        assert conv["messages"][0]["role"] == "user"
        assert conv["messages"][0]["content"] == "My first question"
        assert conv["title"] == "My first question"

    def test_send_message_rejected_when_busy(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = _make_plugin_with_stub_stream(mod, tmp_settings)
        plugin._proc = MagicMock()  # simulate in-flight generation

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        result = asyncio.run(plugin.send_message(conv_id, "Hello"))
        assert result["status"] == "error"

    def test_send_message_resets_stream_state(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = _make_plugin_with_stub_stream(mod, tmp_settings)
        plugin._stream_items = [{"type": "text", "content": "old"}]
        plugin._stream_error = "old error"
        plugin._stream_done = True

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        asyncio.run(plugin.send_message(conv_id, "New"))

        assert plugin._stream_items == []
        assert plugin._stream_error is None
        assert plugin._stream_done is False


class TestStreamProcessing:
    def test_process_assistant_text_block(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._stream_items = []

        plugin._process_event({
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "Hello"}]},
        })

        assert len(plugin._stream_items) == 1
        assert plugin._stream_items[0] == {"type": "text", "content": "Hello"}

    def test_process_assistant_tool_use_block(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._stream_items = []

        plugin._process_event({
            "type": "assistant",
            "message": {"content": [{
                "type": "tool_use",
                "id": "t1",
                "name": "Bash",
                "input": {"command": "ls"},
            }]},
        })

        assert len(plugin._stream_items) == 1
        item = plugin._stream_items[0]
        assert item["type"] == "tool_use"
        assert item["tool_name"] == "Bash"
        assert item["tool_input"] == {"command": "ls"}
        assert item["tool_use_id"] == "t1"

    def test_process_assistant_thinking_block(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._stream_items = []

        plugin._process_event({
            "type": "assistant",
            "message": {"content": [{
                "type": "thinking",
                "thinking": "Reasoning about this",
            }]},
        })

        assert plugin._stream_items[0]["type"] == "thinking"
        assert plugin._stream_items[0]["content"] == "Reasoning about this"

    def test_process_user_tool_result_string(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._stream_items = []

        plugin._process_event({
            "type": "user",
            "message": {"content": [{
                "type": "tool_result",
                "tool_use_id": "t1",
                "content": "file.txt\n",
                "is_error": False,
            }]},
        })

        assert len(plugin._stream_items) == 1
        item = plugin._stream_items[0]
        assert item["type"] == "tool_result"
        assert item["content"] == "file.txt\n"
        assert item["is_error"] is False
        assert item["tool_use_id"] == "t1"

    def test_process_user_tool_result_list(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._stream_items = []

        plugin._process_event({
            "type": "user",
            "message": {"content": [{
                "type": "tool_result",
                "tool_use_id": "t1",
                "content": [
                    {"type": "text", "text": "line 1\n"},
                    {"type": "text", "text": "line 2"},
                ],
            }]},
        })

        assert plugin._stream_items[0]["content"] == "line 1\nline 2"

    def test_process_user_tool_result_error(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._stream_items = []

        plugin._process_event({
            "type": "user",
            "message": {"content": [{
                "type": "tool_result",
                "tool_use_id": "t1",
                "content": "oops",
                "is_error": True,
            }]},
        })

        assert plugin._stream_items[0]["is_error"] is True

    def test_process_result_event(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._stream_session_id = None
        plugin._stream_cost = 0

        plugin._process_event({
            "type": "result",
            "session_id": "s1",
            "total_cost_usd": 0.5,
        })

        assert plugin._stream_session_id == "s1"
        assert plugin._stream_cost == 0.5

    def test_process_multiple_blocks_in_one_event(
        self, tmp_settings: Path,
    ) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._stream_items = []

        plugin._process_event({
            "type": "assistant",
            "message": {"content": [
                {"type": "text", "text": "Let me check"},
                {
                    "type": "tool_use",
                    "id": "t1",
                    "name": "Bash",
                    "input": {"command": "ls"},
                },
            ]},
        })

        assert len(plugin._stream_items) == 2
        assert plugin._stream_items[0]["type"] == "text"
        assert plugin._stream_items[1]["type"] == "tool_use"

    def test_flatten_tool_result(self) -> None:
        mod = import_plugin()
        assert mod.Plugin._flatten_tool_result("hello") == "hello"
        assert mod.Plugin._flatten_tool_result([
            {"type": "text", "text": "a"}, {"type": "text", "text": "b"},
        ]) == "ab"
        assert mod.Plugin._flatten_tool_result([]) == ""
        assert mod.Plugin._flatten_tool_result(None) == "None"


class TestFinalizeStream:
    def test_finalize_saves_all_items_as_separate_messages(
        self, tmp_settings: Path,
    ) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        plugin._stream_items = [
            {"type": "text", "content": "Let me check"},
            {
                "type": "tool_use", "tool_name": "Bash",
                "tool_input": {"command": "ls"}, "tool_use_id": "t1",
            },
            {
                "type": "tool_result", "content": "file.txt",
                "tool_use_id": "t1", "is_error": False,
            },
            {"type": "text", "content": "Done"},
        ]
        plugin._stream_session_id = "sess1"

        plugin._finalize_stream(conv_id)

        conv = plugin._read_conv(conv_id)
        assert len(conv["messages"]) == 4
        assert conv["session_id"] == "sess1"

        text1, tool_use, tool_res, text2 = conv["messages"]
        assert text1["role"] == "assistant"
        assert text1["item_type"] == "text"
        assert text1["content"] == "Let me check"

        assert tool_use["item_type"] == "tool_use"
        assert tool_use["tool_name"] == "Bash"
        assert tool_use["tool_input"] == {"command": "ls"}

        assert tool_res["item_type"] == "tool_result"
        assert tool_res["content"] == "file.txt"
        assert "is_error" not in tool_res

        assert text2["item_type"] == "text"
        assert text2["content"] == "Done"

    def test_finalize_marks_error_tool_results(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        plugin._stream_items = [
            {
                "type": "tool_result", "content": "boom",
                "tool_use_id": "t1", "is_error": True,
            },
        ]
        plugin._finalize_stream(conv_id)

        conv = plugin._read_conv(conv_id)
        assert conv["messages"][0]["is_error"] is True

    def test_finalize_no_items_is_noop(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._conversations_dir.mkdir(parents=True, exist_ok=True)

        created = asyncio.run(plugin.create_conversation())
        conv_id = created["conversation"]["id"]

        plugin._stream_items = []
        plugin._finalize_stream(conv_id)

        conv = plugin._read_conv(conv_id)
        assert conv["messages"] == []


class TestGetStream:
    def test_get_stream_returns_items(self, tmp_settings: Path) -> None:
        mod = import_plugin()
        plugin = make_plugin(mod, tmp_settings)
        plugin._stream_items = [{"type": "text", "content": "Hi"}]
        plugin._stream_done = False
        plugin._stream_session_id = "s1"
        plugin._stream_cost = 0.01

        result = asyncio.run(plugin.get_stream())
        assert result["items"] == [{"type": "text", "content": "Hi"}]
        assert result["done"] is False
        assert result["session_id"] == "s1"
        assert result["cost_usd"] == 0.01
