from enum import Enum


class EventTuiPromptAppendType(str, Enum):
    TUI_PROMPT_APPEND = "tui.prompt.append"

    def __str__(self) -> str:
        return str(self.value)
