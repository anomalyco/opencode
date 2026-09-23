"""Read DeepSeek's current Edge localStorage authentication state.

The reader is intentionally read-only. It scans Chromium's localStorage
LevelDB files and keeps the token only in memory for the current request.
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Tuple


class EdgeAuthError(RuntimeError):
    """Raised when the Edge profile does not contain DeepSeek authentication."""


@dataclass(frozen=True)
class EdgeCredentials:
    token: str = field(repr=False)
    device_id: str = field(repr=False)


class EdgeBrowserAuth:
    """Return the current DeepSeek token from the user's Edge profile."""

    def __init__(
        self,
        *,
        user_data_dir: Optional[str] = None,
        profile: Optional[str] = None,
    ) -> None:
        default_root = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "Microsoft" / "Edge" / "User Data"
        if sys.platform == "darwin":
            default_root = Path.home() / "Library" / "Application Support" / "Microsoft Edge"
        if sys.platform.startswith("linux"):
            default_root = Path.home() / ".config" / "microsoft-edge"
        self.user_data_dir = Path(
            user_data_dir
            or os.environ.get("DEEPSEEK_EDGE_USER_DATA_DIR", "")
            or default_root
        )
        self.profile_override = profile or os.environ.get("DEEPSEEK_EDGE_PROFILE")
        self._fallback_device_id = str(uuid.uuid4())

    def __call__(self) -> Tuple[str, str]:
        credentials = self.get_credentials()
        return credentials.token, credentials.device_id

    def get_credentials(self) -> EdgeCredentials:
        for profile_path in self._profile_paths():
            token = self._read_key(profile_path, "userToken", envelope=True)
            if not token:
                continue
            device_id = self._read_key(
                profile_path,
                "deepseek-device-id:chat",
                envelope=False,
            ) or self._fallback_device_id
            return EdgeCredentials(token=token, device_id=device_id)
        raise EdgeAuthError(
            "Edge 当前用户配置中没有找到 DeepSeek 登录状态；请先在 Edge 打开并登录 chat.deepseek.com。"
        )

    def _profile_paths(self) -> Iterable[Path]:
        if self.profile_override:
            override = Path(self.profile_override)
            yield override if override.is_absolute() else self.user_data_dir / override
            return

        preferred: Optional[str] = None
        state_path = self.user_data_dir / "Local State"
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            profile_state = state.get("profile", {})
            if isinstance(profile_state, dict):
                last_used = profile_state.get("last_used")
                if isinstance(last_used, str):
                    preferred = last_used
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass

        names: List[str] = []
        if preferred:
            names.append(preferred)
        try:
            candidates = sorted(self.user_data_dir.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            candidates = []
        for path in candidates:
            if path.is_dir() and (path.name == "Default" or path.name.startswith("Profile ")):
                if path.name not in names:
                    names.append(path.name)
        for name in names:
            yield self.user_data_dir / name

    def _read_key(self, profile_path: Path, key: str, *, envelope: bool) -> Optional[str]:
        from ccl_chromium_reader import ccl_chromium_localstorage
        leveldb = profile_path / "Local Storage" / "leveldb"
        try:
            with ccl_chromium_localstorage.LocalStoreDb(leveldb) as database:
                records = (
                    record for record in database.iter_records_for_storage_key(
                        'https://chat.deepseek.com', include_deletions=True,
                        raise_on_no_result=False
                    ) if record.script_key == key
                )
                latest = max(records, key=lambda r: r.leveldb_seq_number, default=None)
                if latest is None or not latest.is_live:
                    return None
                value = latest.value
                if envelope:
                    try:
                        parsed = json.loads(value)
                    except json.JSONDecodeError:
                        return value or None
                    value = parsed.get('value') if isinstance(parsed, dict) else parsed
                return value if isinstance(value, str) and value else None
        except OSError:
            return None
