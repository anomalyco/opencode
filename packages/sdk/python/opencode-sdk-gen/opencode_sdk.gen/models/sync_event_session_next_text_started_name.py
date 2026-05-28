from enum import Enum


class SyncEventSessionNextTextStartedName(str, Enum):
    SESSION_NEXT_TEXT_STARTED_1 = "session.next.text.started.1"

    def __str__(self) -> str:
        return str(self.value)
