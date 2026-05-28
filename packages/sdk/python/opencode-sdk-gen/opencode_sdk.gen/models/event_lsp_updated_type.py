from enum import Enum


class EventLspUpdatedType(str, Enum):
    LSP_UPDATED = "lsp.updated"

    def __str__(self) -> str:
        return str(self.value)
