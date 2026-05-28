from enum import Enum


class ModelV2InfoTimeReleasedType2(str, Enum):
    INFINITY = "Infinity"

    def __str__(self) -> str:
        return str(self.value)
