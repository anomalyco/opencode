from enum import Enum


class ProviderConfigModelsAdditionalPropertyInterleavedType1Field(str, Enum):
    REASONING_CONTENT = "reasoning_content"
    REASONING_DETAILS = "reasoning_details"

    def __str__(self) -> str:
        return str(self.value)
