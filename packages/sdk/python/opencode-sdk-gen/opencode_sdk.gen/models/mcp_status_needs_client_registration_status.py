from enum import Enum


class MCPStatusNeedsClientRegistrationStatus(str, Enum):
    NEEDS_CLIENT_REGISTRATION = "needs_client_registration"

    def __str__(self) -> str:
        return str(self.value)
