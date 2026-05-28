from enum import Enum


class ModelV2Info1EndpointType3Type(str, Enum):
    ANTHROPICMESSAGES = "anthropic/messages"

    def __str__(self) -> str:
        return str(self.value)
