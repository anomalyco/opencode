from enum import Enum


class ModelV2InfoTimeReleasedType3(str, Enum):
    VALUE_0 = "-Infinity"

    def __str__(self) -> str:
        return str(self.value)
