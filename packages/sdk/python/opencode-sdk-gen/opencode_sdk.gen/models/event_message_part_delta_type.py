from enum import Enum


class EventMessagePartDeltaType(str, Enum):
    MESSAGE_PART_DELTA = "message.part.delta"

    def __str__(self) -> str:
        return str(self.value)
