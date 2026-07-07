"""Shared test fixtures and mock decky module."""

import importlib
import logging
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parent.parent

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _create_mock_decky(settings_dir: str) -> MagicMock:
    mock = MagicMock()
    mock.DECKY_PLUGIN_SETTINGS_DIR = settings_dir
    mock.DECKY_PLUGIN_RUNTIME_DIR = settings_dir
    mock.DECKY_PLUGIN_LOG_DIR = settings_dir
    mock.DECKY_USER_HOME = settings_dir
    mock.logger = logging.getLogger("decky.test")
    return mock


@pytest.fixture()
def tmp_settings(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture(autouse=True)
def mock_decky(tmp_settings: Path) -> MagicMock:
    mock = _create_mock_decky(str(tmp_settings))
    sys.modules["decky"] = mock  # type: ignore[assignment]
    yield mock
    sys.modules.pop("decky", None)


def import_plugin():
    sys.modules.pop("main", None)
    spec = importlib.util.spec_from_file_location("main", ROOT / "main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def make_plugin(mod, tmp_settings: Path):
    plugin = mod.Plugin()
    plugin._settings_dir = tmp_settings
    plugin._conversations_dir = tmp_settings / "conversations"
    plugin._settings_file = tmp_settings / "settings.json"
    plugin._settings = mod.Plugin._get_defaults(plugin)
    return plugin
