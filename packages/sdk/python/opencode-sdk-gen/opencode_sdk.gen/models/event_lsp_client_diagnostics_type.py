from enum import Enum


class EventLspClientDiagnosticsType(str, Enum):
    LSP_CLIENT_DIAGNOSTICS = "lsp.client.diagnostics"

    def __str__(self) -> str:
        return str(self.value)
