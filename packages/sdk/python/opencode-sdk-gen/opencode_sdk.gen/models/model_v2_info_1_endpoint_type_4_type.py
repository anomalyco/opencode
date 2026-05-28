from enum import Enum


class ModelV2Info1EndpointType4Type(str, Enum):
    AISDK = "aisdk"

    def __str__(self) -> str:
        return str(self.value)
