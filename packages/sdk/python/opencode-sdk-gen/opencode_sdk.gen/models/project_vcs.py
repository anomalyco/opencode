from enum import Enum


class ProjectVcs(str, Enum):
    GIT = "git"

    def __str__(self) -> str:
        return str(self.value)
