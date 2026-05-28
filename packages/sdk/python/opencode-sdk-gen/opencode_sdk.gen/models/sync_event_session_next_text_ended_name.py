from enum import Enum


class SyncEventSessionNextTextEndedName(str, Enum):
    SESSION_NEXT_TEXT_ENDED_1 = "session.next.text.ended.1"

    def __str__(self) -> str:
        return str(self.value)
