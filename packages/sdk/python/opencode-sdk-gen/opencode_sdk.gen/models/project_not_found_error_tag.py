from enum import Enum


class ProjectNotFoundErrorTag(str, Enum):
    PROJECTNOTFOUNDERROR = "ProjectNotFoundError"

    def __str__(self) -> str:
        return str(self.value)
