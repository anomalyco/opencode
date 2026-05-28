from enum import Enum


class EventCatalogModelUpdatedType(str, Enum):
    CATALOG_MODEL_UPDATED = "catalog.model.updated"

    def __str__(self) -> str:
        return str(self.value)
