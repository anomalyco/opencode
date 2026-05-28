from enum import Enum


class EventGlobalDisposedType(str, Enum):
    GLOBAL_DISPOSED = "global.disposed"

    def __str__(self) -> str:
        return str(self.value)
