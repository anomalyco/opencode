from enum import Enum


class PtyForbiddenErrorTag(str, Enum):
    PTYFORBIDDENERROR = "PtyForbiddenError"

    def __str__(self) -> str:
        return str(self.value)
