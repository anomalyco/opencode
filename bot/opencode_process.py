"""
Управление процессом OpenCode (lildax)
"""
import asyncio
import json
import os
import subprocess
import socket
from pathlib import Path

from config import OPENCODE_BIN, OPENCODE_CONFIG_PATH, PROVIDER_URL, CLI_MODEL, MCP_SERVERS
from logging_config import logger


def sync_mcp_to_lildax_config() -> bool:
    """Синхронизирует MCP сервера из bot/config.json в lildax config.

    Читает mcp_servers из bot/config.json и обновляет секцию 'mcp'
    в ~/.config/lildax/config.json.

    Returns:
        True если успешно, иначе False
    """
    try:
        # Путь к lildax config (OPENCODE_CONFIG_PATH)
        lildax_config_path = Path(OPENCODE_CONFIG_PATH).expanduser()

        if not MCP_SERVERS:
            logger.debug("No mcp_servers in bot config, skipping sync")
            return True

        # Читаем текущий lildax config
        try:
            with open(lildax_config_path, "r", encoding="utf-8") as f:
                lildax_config = json.load(f)
        except FileNotFoundError:
            logger.warning(f"Lildax config not found at {lildax_config_path}, creating new")
            lildax_config = {}
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in lildax config: {e}")
            return False

        # Обновляем или создаём секцию mcp
        if "mcp" not in lildax_config:
            lildax_config["mcp"] = {}

        # Формат: { "server-name": { "type": "local", "command": [...], "enabled": true } }
        for server_name, server_config in MCP_SERVERS.items():
            if isinstance(server_config, dict) and server_config.get("enabled", True):
                lildax_config["mcp"][server_name] = {
                    "type": server_config.get("type", "local"),
                    "command": server_config.get("command", []),
                }
                if "cwd" in server_config:
                    lildax_config["mcp"][server_name]["cwd"] = server_config["cwd"]
                if "environment" in server_config:
                    lildax_config["mcp"][server_name]["environment"] = server_config["environment"]

        # Сохраняем обновлённый config
        lildax_config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(lildax_config_path, "w", encoding="utf-8") as f:
            json.dump(lildax_config, f, indent=2, ensure_ascii=False)

        logger.info(f"Synced {len(MCP_SERVERS)} MCP servers to {lildax_config_path}")
        return True

    except Exception as e:
        logger.error(f"Failed to sync MCP to lildax config: {e}")
        return False


class OpenCodeProcess:
    """Управление процессом lildax serve."""

    def __init__(self, model: str = None, provider_url: str = None, workdir: Path = None):
        self.logger = logger
        self.process = None
        self.opencode_port = 4098
        self.model = model or CLI_MODEL
        self.provider_url = provider_url or PROVIDER_URL
        self.workdir = workdir or Path.cwd()
        self.logger.debug(
            f"OpenCodeProcess initialized: workdir={self.workdir}, model={self.model}, provider_url={self.provider_url}"
        )

    def _remove_password_file(self):
        """Удаляет файл password, чтобы lildax не требовал аутентификацию."""
        password_file = Path.home() / ".local" / "state" / "lildax" / "password"
        if password_file.exists():
            try:
                os.remove(password_file)
                self.logger.info(f"Removed password file: {password_file}")
            except Exception as e:
                self.logger.warning(f"Failed to remove password file: {e}")

    def _build_args(self) -> list[str]:
        args = [str(OPENCODE_BIN), "serve", "--port", str(self.opencode_port)]
        if self.provider_url:
            args.extend(["--provider-url", self.provider_url])
        if self.model:
            args.extend(["--model", self.model])
        return args

    async def start(self):
        workdir_str = str(self.workdir)
        self.logger.info(f"Starting lildax serve in {workdir_str}")
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

        # Синхронизируем MCP сервера в lildax config (после убийства, до старта)
        sync_mcp_to_lildax_config()

        # Логирование в файл для отладки
        log_file_path = f"/tmp/lildax_{self.opencode_port}.log"
        log_file = None

        try:
            log_file = open(log_file_path, "w")

            self.process = subprocess.Popen(
                self._build_args(),
                stdout=log_file,
                stderr=log_file,
                cwd=workdir_str,
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
                    raise RuntimeError(f"lildax exited early: {stderr_str}")
                try:
                    sock = socket.create_connection(("127.0.0.1", self.opencode_port), timeout=1)
                    sock.close()
                    self.logger.info("lildax server is ready")
                    return
                except (OSError, socket.timeout):
                    pass
                await asyncio.sleep(0.5)
            raise TimeoutError("lildax server did not become ready in time")
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
            f"restart: restarting lildax serve with model={self.model}, workdir={self.workdir}"
        )
        await self.stop()
        await asyncio.sleep(1)
        await self.start()
        self.logger.info(f"lildax serve restarted with model={self.model}, workdir={self.workdir}")

    async def stop(self):
        if self.process:
            self.logger.info(f"Stopping lildax serve, pid={self.process.pid}")
            pid = self.process.pid
            self.process.terminate()
            for _ in range(50):  # до 5 секунд с проверками
                if self.process.poll() is not None:
                    break
                await asyncio.sleep(0.1)
            if self.process.poll() is None:
                self.logger.warning("lildax didn't stop gracefully, killing")
                self.process.kill()
                self.process.wait()
            self.logger.info(f"lildax serve stopped (pid={pid})")
            self.process = None
