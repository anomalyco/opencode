from enum import Enum


class EventTuiCommandExecutePropertiesCommandType0(str, Enum):
    AGENT_CYCLE = "agent.cycle"
    PROMPT_CLEAR = "prompt.clear"
    PROMPT_SUBMIT = "prompt.submit"
    SESSION_COMPACT = "session.compact"
    SESSION_FIRST = "session.first"
    SESSION_HALF_PAGE_DOWN = "session.half.page.down"
    SESSION_HALF_PAGE_UP = "session.half.page.up"
    SESSION_INTERRUPT = "session.interrupt"
    SESSION_LAST = "session.last"
    SESSION_LINE_DOWN = "session.line.down"
    SESSION_LINE_UP = "session.line.up"
    SESSION_LIST = "session.list"
    SESSION_NEW = "session.new"
    SESSION_PAGE_DOWN = "session.page.down"
    SESSION_PAGE_UP = "session.page.up"
    SESSION_SHARE = "session.share"

    def __str__(self) -> str:
        return str(self.value)
