"""
Управление процессом OpenCode
"""
import asyncio
import json
import os
import subprocess
import socket
from pathlib import Path

from config import OPENCODE_BIN, OPENCODE_CONFIG_PATH, PROVIDER_URL, CLI_MODEL, MCP_SERVERS, OPENCODE_APP_NAME, OPENCODE_URL
from logging_config import logger


def _parse_port_from_url(url: str) -> int:
    """Извлекает порт из URL. По умолчанию 4098."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        if parsed.port:
            return parsed.port
    except Exception:
        pass
    return 4098


def sync_mcp_to_opencode_config() -> bool:
    """Синхронизирует MCP сервера из bot/config.json в opencode config.

    Читает mcp_servers из bot/config.json и обновляет секцию 'mcp'
    в opencode config (OPENCODE_CONFIG_PATH).

    Returns:
        True если успешно, иначе False
    """
    try:
        # Путь к opencode config (OPENCODE_CONFIG_PATH)
        opencode_config_path = Path(OPENCODE_CONFIG_PATH).expanduser()

        if not MCP_SERVERS:
            logger.debug("No mcp_servers in bot config, skipping sync")
            return True

        # Читаем текущий opencode config
        try:
            with open(opencode_config_path, "r", encoding="utf-8") as f:
                opencode_config = json.load(f)
        except FileNotFoundError:
            logger.warning(f"OpenCode config not found at {opencode_config_path}, creating new")
            opencode_config = {}
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in opencode config: {e}")
            return False

        # Обновляем или создаём секцию mcp
        if "mcp" not in opencode_config:
            opencode_config["mcp"] = {}

        # Формат: { "server-name": { "type": "local", "command": [...], "enabled": true } }
        for server_name, server_config in MCP_SERVERS.items():
            if isinstance(server_config, dict) and server_config.get("enabled", True):
                opencode_config["mcp"][server_name] = {
                    "type": server_config.get("type", "local"),
                    "command": server_config.get("command", []),
                }
                if "cwd" in server_config:
                    opencode_config["mcp"][server_name]["cwd"] = server_config["cwd"]
                if "environment" in server_config:
                    opencode_config["mcp"][server_name]["environment"] = server_config["environment"]

        # Сохраняем обновлённый config
        opencode_config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(opencode_config_path, "w", encoding="utf-8") as f:
            json.dump(opencode_config, f, indent=2, ensure_ascii=False)

        logger.info(f"Synced {len(MCP_SERVERS)} MCP servers to {opencode_config_path}")
        return True

    except Exception as e:
        logger.error(f"Failed to sync MCP to opencode config: {e}")
        return False


class OpenCodeProcess:
    """Управление процессом opencode serve."""

    def __init__(self, model: str = None, provider_url: str = None, workdir: Path = None):
        self.logger = logger
        self.process = None
        self.opencode_port = _parse_port_from_url(OPENCODE_URL)
        self.model = model or CLI_MODEL
        self.provider_url = provider_url or PROVIDER_URL
        self.workdir = workdir or Path.cwd()
        self.logger.debug(
            f"OpenCodeProcess initialized: workdir={self.workdir}, model={self.model}, provider_url={self.provider_url}"
        )

    def _remove_password_file(self):
        """Удаляет файл password, чтобы opencode не требовал аутентификацию."""
        password_file = Path.home() / ".local" / "state" / OPENCODE_APP_NAME / "password"
        if password_file.exists():
            try:
                os.remove(password_file)
                self.logger.info(f"Removed password file: {password_file}")
            except Exception as e:
                self.logger.warning(f"Failed to remove password file: {e}")

    def _build_args(self) -> list[str]:
        args = [str(OPENCODE_BIN), "serve", "--port", str(self.opencode_port)]
        if OPENCODE_APP_NAME:
            args.extend(["--app-name", OPENCODE_APP_NAME])
        if self.provider_url:
            args.extend(["--provider-url", self.provider_url])
        if self.model:
            args.extend(["--model", self.model])
        return args

    def _build_env(self) -> dict[str, str]:
        """Строит environment для opencode процесса."""
        env = os.environ.copy()
        # Включаем v2 события (session.next.text.ended и т.д.)
        env["OPENCODE_EXPERIMENTAL_EVENT_SYSTEM"] = "true"
        # Передаём путь к конфигу с MCP серверами
        env["OPENCODE_CONFIG"] = str(Path(OPENCODE_CONFIG_PATH).expanduser())
        return env

    async def start(self):
        workdir_str = str(self.workdir)
        self.logger.info(f"Starting opencode serve in {workdir_str}")
        self.logger.info(f"Args: {' '.join(self._build_args())}")

        # Удаляем файл password, чтобы отключить аутентификацию
        self._remove_password_file()

        # убиваем старые процессы и ждём освобождения порта
        subprocess.run(
            ["pkill", "-9", "-f", f"{OPENCODE_BIN} serve"], stderr=subprocess.DEVNULL
        )
        for _ in range(10):
            result = subprocess.run(
                ["lsof", "-i", f":{self.opencode_port}"], capture_output=True
            )
            if result.returncode != 0:
                break
            await asyncio.sleep(0.5)

        # Синхронизируем MCP сервера в opencode config (после убийства, до старта)
        sync_mcp_to_opencode_config()

        # Логирование в файл для отладки
        log_file_path = f"/tmp/opencode_{self.opencode_port}.log"
        log_file = None

        try:
            log_file = open(log_file_path, "w")

            self.process = subprocess.Popen(
                self._build_args(),
                stdout=log_file,
                stderr=log_file,
                cwd=workdir_str,
                env=self._build_env(),
                start_new_session=True,
            )
            self.logger.info(
                f"Started with PID {self.process.pid}, log file: {log_file_path}"
            )

            # ждём, пока процесс не упадёт или порт не начнёт отвечать
            for _ in range(30):  # 15 секунд
                if self.process.poll() is not None:
                    stdout, stderr = self.process.communicate()
                    stderr_str = stderr.decode() if stderr else "no stderr available"
                    raise RuntimeError(f"opencode exited early: {stderr_str}")
                try:
                    sock = socket.create_connection(("127.0.0.1", self.opencode_port), timeout=1)
                    sock.close()
                    self.logger.info("opencode server is ready")
                    return
                except (OSError, socket.timeout):
                    pass
                await asyncio.sleep(0.5)
            raise TimeoutError("opencode server did not become ready in time")
        finally:
            if log_file:
                log_file.close()

    async def restart(self, model: str = None, provider_url: str = None, workdir: Path = None):
        if model:
            self.model = model
        if provider_url:
            self.provider_url = provider_url
        if workdir:
            self.logger.info(
                f"restart: updating workdir from {self.workdir} to {workdir}"
            )
            self.workdir = workdir
        self.logger.info(
            f"restart: restarting opencode serve with model={self.model}, workdir={self.workdir}"
        )
        await self.stop()
        await asyncio.sleep(1)
        await self.start()
        self.logger.info(f"opencode serve restarted with model={self.model}, workdir={self.workdir}")

    async def stop(self):
        if self.process:
            self.logger.info(f"Stopping opencode serve, pid={self.process.pid}")
            pid = self.process.pid
            self.process.terminate()
            for _ in range(50):  # до 5 секунд с проверками
                if self.process.poll() is not None:
                    break
                await asyncio.sleep(0.1)
            if self.process.poll() is None:
                self.logger.warning("opencode didn't stop gracefully, killing")
                self.process.kill()
                self.process.wait()
            self.logger.info(f"opencode serve stopped (pid={pid})")
            self.process = None
