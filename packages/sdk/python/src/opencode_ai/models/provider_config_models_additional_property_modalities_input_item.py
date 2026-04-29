from enum import Enum


class ProviderConfigModelsAdditionalPropertyModalitiesInputItem(str, Enum):
    AUDIO = "audio"
    IMAGE = "image"
    PDF = "pdf"
    TEXT = "text"
    VIDEO = "video"

    def __str__(self) -> str:
        return str(self.value)
