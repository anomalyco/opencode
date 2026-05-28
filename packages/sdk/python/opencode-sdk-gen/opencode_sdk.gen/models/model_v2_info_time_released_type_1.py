from enum import Enum


class ModelV2InfoTimeReleasedType1(str, Enum):
    NAN = "NaN"

    def __str__(self) -> str:
        return str(self.value)
