from enum import Enum


class CommandSource(str, Enum):
    COMMAND = "command"
    MCP = "mcp"
    SKILL = "skill"

    def __str__(self) -> str:
        return str(self.value)
