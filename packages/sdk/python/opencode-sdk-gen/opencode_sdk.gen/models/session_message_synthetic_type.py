from enum import Enum


class SessionMessageSyntheticType(str, Enum):
    SYNTHETIC = "synthetic"

    def __str__(self) -> str:
        return str(self.value)
