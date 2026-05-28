from enum import Enum


class PatchPartType(str, Enum):
    PATCH = "patch"

    def __str__(self) -> str:
        return str(self.value)
