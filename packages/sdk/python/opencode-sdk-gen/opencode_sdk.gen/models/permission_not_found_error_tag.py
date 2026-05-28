from enum import Enum


class PermissionNotFoundErrorTag(str, Enum):
    PERMISSIONNOTFOUNDERROR = "PermissionNotFoundError"

    def __str__(self) -> str:
        return str(self.value)
