from enum import Enum


class ModelV2Info1EndpointType2ReasoningType1Type(str, Enum):
    REASONING_DETAILS = "reasoning_details"

    def __str__(self) -> str:
        return str(self.value)
