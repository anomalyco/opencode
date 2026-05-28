from enum import Enum


class EventTuiSessionSelectType(str, Enum):
    TUI_SESSION_SELECT = "tui.session.select"

    def __str__(self) -> str:
        return str(self.value)
