from enum import Enum


class EventMcpToolsChangedType(str, Enum):
    MCP_TOOLS_CHANGED = "mcp.tools.changed"

    def __str__(self) -> str:
        return str(self.value)
