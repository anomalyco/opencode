from enum import Enum


class EventInstallationUpdateAvailableType(str, Enum):
    INSTALLATION_UPDATE_AVAILABLE = "installation.update-available"

    def __str__(self) -> str:
        return str(self.value)
