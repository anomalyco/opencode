from enum import Enum


class McpRemoteConfigType(str, Enum):
    REMOTE = "remote"

    def __str__(self) -> str:
        return str(self.value)
