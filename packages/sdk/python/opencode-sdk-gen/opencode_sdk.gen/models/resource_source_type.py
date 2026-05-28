from enum import Enum


class ResourceSourceType(str, Enum):
    RESOURCE = "resource"

    def __str__(self) -> str:
        return str(self.value)
