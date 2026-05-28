from enum import Enum


class ProviderV2InfoEndpointType0Type(str, Enum):
    UNKNOWN = "unknown"

    def __str__(self) -> str:
        return str(self.value)
