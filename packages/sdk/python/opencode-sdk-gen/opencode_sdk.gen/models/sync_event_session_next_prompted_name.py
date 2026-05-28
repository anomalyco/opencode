from enum import Enum


class SyncEventSessionNextPromptedName(str, Enum):
    SESSION_NEXT_PROMPTED_1 = "session.next.prompted.1"

    def __str__(self) -> str:
        return str(self.value)
