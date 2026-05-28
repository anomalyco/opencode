from enum import Enum


class EventFileEditedType(str, Enum):
    FILE_EDITED = "file.edited"

    def __str__(self) -> str:
        return str(self.value)
