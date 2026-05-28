from enum import Enum


class SyncEventSessionNextSyntheticName(str, Enum):
    SESSION_NEXT_SYNTHETIC_1 = "session.next.synthetic.1"

    def __str__(self) -> str:
        return str(self.value)
