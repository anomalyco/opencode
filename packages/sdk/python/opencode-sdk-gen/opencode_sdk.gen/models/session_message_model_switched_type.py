from enum import Enum


class SessionMessageModelSwitchedType(str, Enum):
    MODEL_SWITCHED = "model-switched"

    def __str__(self) -> str:
        return str(self.value)
