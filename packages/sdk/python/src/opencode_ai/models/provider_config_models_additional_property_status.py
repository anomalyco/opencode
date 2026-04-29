from enum import Enum


class ProviderConfigModelsAdditionalPropertyStatus(str, Enum):
    ALPHA = "alpha"
    BETA = "beta"
    DEPRECATED = "deprecated"

    def __str__(self) -> str:
        return str(self.value)
