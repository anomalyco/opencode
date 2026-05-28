from enum import Enum


class SyncEventSessionNextRetriedName(str, Enum):
    SESSION_NEXT_RETRIED_1 = "session.next.retried.1"

    def __str__(self) -> str:
        return str(self.value)
