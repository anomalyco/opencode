from enum import Enum


class EffectHttpApiErrorInternalServerErrorTag(str, Enum):
    INTERNALSERVERERROR = "InternalServerError"

    def __str__(self) -> str:
        return str(self.value)
