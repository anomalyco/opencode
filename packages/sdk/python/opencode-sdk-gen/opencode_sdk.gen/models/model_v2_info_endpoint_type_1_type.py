from enum import Enum


class ModelV2InfoEndpointType1Type(str, Enum):
    OPENAIRESPONSES = "openai/responses"

    def __str__(self) -> str:
        return str(self.value)
