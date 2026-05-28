from enum import Enum


class EventSessionNextModelSwitchedType(str, Enum):
    SESSION_NEXT_MODEL_SWITCHED = "session.next.model.switched"

    def __str__(self) -> str:
        return str(self.value)
