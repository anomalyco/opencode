from enum import Enum


class PermissionRespondBodyResponse(str, Enum):
    ALWAYS = "always"
    ONCE = "once"
    REJECT = "reject"

    def __str__(self) -> str:
        return str(self.value)
