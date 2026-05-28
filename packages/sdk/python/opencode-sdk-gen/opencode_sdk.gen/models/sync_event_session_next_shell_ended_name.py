from enum import Enum


class SyncEventSessionNextShellEndedName(str, Enum):
    SESSION_NEXT_SHELL_ENDED_1 = "session.next.shell.ended.1"

    def __str__(self) -> str:
        return str(self.value)
