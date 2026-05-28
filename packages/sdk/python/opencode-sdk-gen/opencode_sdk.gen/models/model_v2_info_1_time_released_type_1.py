from enum import Enum


class ModelV2Info1TimeReleasedType1(str, Enum):
    NAN = "NaN"

    def __str__(self) -> str:
        return str(self.value)
