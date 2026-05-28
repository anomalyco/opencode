from enum import Enum


class EventTuiToastShowType(str, Enum):
    TUI_TOAST_SHOW = "tui.toast.show"

    def __str__(self) -> str:
        return str(self.value)
