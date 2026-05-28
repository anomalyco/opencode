from enum import Enum


class ModelV2Info1EndpointType1Type(str, Enum):
    OPENAIRESPONSES = "openai/responses"

    def __str__(self) -> str:
        return str(self.value)
