from enum import Enum


class EventTuiCommandExecuteType(str, Enum):
    TUI_COMMAND_EXECUTE = "tui.command.execute"

    def __str__(self) -> str:
        return str(self.value)
