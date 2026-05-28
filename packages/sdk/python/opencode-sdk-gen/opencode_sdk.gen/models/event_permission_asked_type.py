from enum import Enum


class EventPermissionAskedType(str, Enum):
    PERMISSION_ASKED = "permission.asked"

    def __str__(self) -> str:
        return str(self.value)
