from enum import Enum


class EventInstallationUpdatedType(str, Enum):
    INSTALLATION_UPDATED = "installation.updated"

    def __str__(self) -> str:
        return str(self.value)
