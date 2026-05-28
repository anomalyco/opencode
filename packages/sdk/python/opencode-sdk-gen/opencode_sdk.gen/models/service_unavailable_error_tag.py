from enum import Enum


class ServiceUnavailableErrorTag(str, Enum):
    SERVICEUNAVAILABLEERROR = "ServiceUnavailableError"

    def __str__(self) -> str:
        return str(self.value)
