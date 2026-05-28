from enum import Enum


class EffectHttpApiErrorBadRequestTag(str, Enum):
    BADREQUEST = "BadRequest"

    def __str__(self) -> str:
        return str(self.value)
