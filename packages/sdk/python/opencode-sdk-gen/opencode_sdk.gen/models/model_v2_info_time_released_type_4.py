from enum import Enum


class ModelV2InfoTimeReleasedType4(str, Enum):
    INFINITY = "Infinity"
    NAN = "NaN"
    VALUE_1 = "-Infinity"

    def __str__(self) -> str:
        return str(self.value)
