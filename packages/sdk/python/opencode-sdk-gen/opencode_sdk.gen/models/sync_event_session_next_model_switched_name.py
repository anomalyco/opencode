from enum import Enum


class SyncEventSessionNextModelSwitchedName(str, Enum):
    SESSION_NEXT_MODEL_SWITCHED_1 = "session.next.model.switched.1"

    def __str__(self) -> str:
        return str(self.value)
