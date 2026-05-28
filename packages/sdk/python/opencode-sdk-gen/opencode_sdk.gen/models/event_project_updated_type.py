from enum import Enum


class EventProjectUpdatedType(str, Enum):
    PROJECT_UPDATED = "project.updated"

    def __str__(self) -> str:
        return str(self.value)
