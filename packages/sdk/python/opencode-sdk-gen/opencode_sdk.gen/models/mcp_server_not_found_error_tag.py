from enum import Enum


class McpServerNotFoundErrorTag(str, Enum):
    MCPSERVERNOTFOUNDERROR = "McpServerNotFoundError"

    def __str__(self) -> str:
        return str(self.value)
