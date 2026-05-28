from enum import Enum


class EventModelsDevRefreshedType(str, Enum):
    MODELS_DEV_REFRESHED = "models-dev.refreshed"

    def __str__(self) -> str:
        return str(self.value)
