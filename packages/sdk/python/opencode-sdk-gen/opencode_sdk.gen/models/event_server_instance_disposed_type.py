from enum import Enum


class EventServerInstanceDisposedType(str, Enum):
    SERVER_INSTANCE_DISPOSED = "server.instance.disposed"

    def __str__(self) -> str:
        return str(self.value)
