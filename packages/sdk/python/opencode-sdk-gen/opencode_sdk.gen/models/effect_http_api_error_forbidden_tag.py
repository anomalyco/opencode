from enum import Enum


class EffectHttpApiErrorForbiddenTag(str, Enum):
    FORBIDDEN = "Forbidden"

    def __str__(self) -> str:
        return str(self.value)
