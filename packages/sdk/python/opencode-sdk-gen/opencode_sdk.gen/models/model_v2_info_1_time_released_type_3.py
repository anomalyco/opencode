from enum import Enum


class ModelV2Info1TimeReleasedType3(str, Enum):
    VALUE_0 = "-Infinity"

    def __str__(self) -> str:
        return str(self.value)
