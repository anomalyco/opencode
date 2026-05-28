from enum import Enum


class EventMcpBrowserOpenFailedType(str, Enum):
    MCP_BROWSER_OPEN_FAILED = "mcp.browser.open.failed"

    def __str__(self) -> str:
        return str(self.value)
