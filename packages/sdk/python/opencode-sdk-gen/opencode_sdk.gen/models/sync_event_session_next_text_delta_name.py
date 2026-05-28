from enum import Enum


class SyncEventSessionNextTextDeltaName(str, Enum):
    SESSION_NEXT_TEXT_DELTA_1 = "session.next.text.delta.1"

    def __str__(self) -> str:
        return str(self.value)
