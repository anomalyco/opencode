from enum import Enum


class ProviderConfigModelsAdditionalPropertyModalitiesOutputItem(str, Enum):
    AUDIO = "audio"
    IMAGE = "image"
    PDF = "pdf"
    TEXT = "text"
    VIDEO = "video"

    def __str__(self) -> str:
        return str(self.value)
