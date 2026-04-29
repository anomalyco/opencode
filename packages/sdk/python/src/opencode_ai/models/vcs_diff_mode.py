from enum import Enum


class VcsDiffMode(str, Enum):
    BRANCH = "branch"
    GIT = "git"

    def __str__(self) -> str:
        return str(self.value)
