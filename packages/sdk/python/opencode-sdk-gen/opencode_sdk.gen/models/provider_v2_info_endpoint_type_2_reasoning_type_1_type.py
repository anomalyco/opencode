from enum import Enum


class ProviderV2InfoEndpointType2ReasoningType1Type(str, Enum):
    REASONING_DETAILS = "reasoning_details"

    def __str__(self) -> str:
        return str(self.value)
