from enum import Enum


class ProviderV2InfoEndpointType3Type(str, Enum):
    ANTHROPICMESSAGES = "anthropic/messages"

    def __str__(self) -> str:
        return str(self.value)
