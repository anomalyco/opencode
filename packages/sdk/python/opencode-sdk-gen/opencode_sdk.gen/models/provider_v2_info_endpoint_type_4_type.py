from enum import Enum


class ProviderV2InfoEndpointType4Type(str, Enum):
    AISDK = "aisdk"

    def __str__(self) -> str:
        return str(self.value)
