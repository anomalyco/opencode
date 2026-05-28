from enum import Enum


class EventSessionNextSyntheticType(str, Enum):
    SESSION_NEXT_SYNTHETIC = "session.next.synthetic"

    def __str__(self) -> str:
        return str(self.value)
