"""
Управление процессом OpenCode (lildax)
"""
import asyncio
import os
import subprocess
import socket
from pathlib import Path

from config import OPENCODE_BIN, PROVIDER_URL, CLI_MODEL
from logging_config import logger


class OpenCodeProcess:
    """Управление процессом lildax serve."""

    def __init__(self, model: str = None, provider_url: str = None, workdir: Path = None):
        self.logger = logger
        self.process = None
        self.opencode_port = 4096
        self.model = model or CLI_MODEL
        self.provider_url = provider_url or PROVIDER_URL
        self.workdir = workdir or Path.cwd()
        self.logger.debug(
            f"OpenCodeProcess initialized: workdir={self.workdir}, model={self.model}, provider_url={self.provider_url}"
        )

    def _remove_password_file(self):
        """Удаляет файл password, чтобы lildax не требовал аутентификацию."""
        password_file = Path.home() / ".local" / "state" / "opencode" / "password"
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
