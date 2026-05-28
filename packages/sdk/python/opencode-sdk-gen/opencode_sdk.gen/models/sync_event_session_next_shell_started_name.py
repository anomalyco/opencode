from enum import Enum


class SyncEventSessionNextShellStartedName(str, Enum):
    SESSION_NEXT_SHELL_STARTED_1 = "session.next.shell.started.1"

    def __str__(self) -> str:
        return str(self.value)
