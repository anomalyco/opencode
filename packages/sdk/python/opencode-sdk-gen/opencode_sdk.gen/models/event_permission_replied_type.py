from enum import Enum


class EventPermissionRepliedType(str, Enum):
    PERMISSION_REPLIED = "permission.replied"

    def __str__(self) -> str:
        return str(self.value)
