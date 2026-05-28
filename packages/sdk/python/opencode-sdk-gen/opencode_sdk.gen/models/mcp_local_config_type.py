from enum import Enum


class McpLocalConfigType(str, Enum):
    LOCAL = "local"

    def __str__(self) -> str:
        return str(self.value)
