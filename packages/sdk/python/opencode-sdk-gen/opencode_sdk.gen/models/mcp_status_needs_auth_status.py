from enum import Enum


class MCPStatusNeedsAuthStatus(str, Enum):
    NEEDS_AUTH = "needs_auth"

    def __str__(self) -> str:
        return str(self.value)
