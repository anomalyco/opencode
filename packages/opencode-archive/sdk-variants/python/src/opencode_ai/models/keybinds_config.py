from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="KeybindsConfig")


@_attrs_define
class KeybindsConfig:
    """Custom keybind configurations

    Attributes:
        leader (Union[Unset, str]): Leader key for keybind combinations Default: 'ctrl+x'.
        app_help (Union[Unset, str]): Show help dialog Default: '<leader>h'.
        app_exit (Union[Unset, str]): Exit the application Default: 'ctrl+c,<leader>q'.
        editor_open (Union[Unset, str]): Open external editor Default: '<leader>e'.
        theme_list (Union[Unset, str]): List available themes Default: '<leader>t'.
        project_init (Union[Unset, str]): Create/update AGENTS.md Default: '<leader>i'.
        tool_details (Union[Unset, str]): Toggle tool details Default: '<leader>d'.
        thinking_blocks (Union[Unset, str]): Toggle thinking blocks Default: '<leader>b'.
        session_export (Union[Unset, str]): Export session to editor Default: '<leader>x'.
        session_new (Union[Unset, str]): Create a new session Default: '<leader>n'.
        session_list (Union[Unset, str]): List all sessions Default: '<leader>l'.
        session_timeline (Union[Unset, str]): Show session timeline Default: '<leader>g'.
        session_share (Union[Unset, str]): Share current session Default: '<leader>s'.
        session_unshare (Union[Unset, str]): Unshare current session Default: 'none'.
        session_interrupt (Union[Unset, str]): Interrupt current session Default: 'esc'.
        session_compact (Union[Unset, str]): Compact the session Default: '<leader>c'.
        session_child_cycle (Union[Unset, str]): Cycle to next child session Default: 'ctrl+right'.
        session_child_cycle_reverse (Union[Unset, str]): Cycle to previous child session Default: 'ctrl+left'.
        messages_page_up (Union[Unset, str]): Scroll messages up by one page Default: 'pgup'.
        messages_page_down (Union[Unset, str]): Scroll messages down by one page Default: 'pgdown'.
        messages_half_page_up (Union[Unset, str]): Scroll messages up by half page Default: 'ctrl+alt+u'.
        messages_half_page_down (Union[Unset, str]): Scroll messages down by half page Default: 'ctrl+alt+d'.
        messages_first (Union[Unset, str]): Navigate to first message Default: 'ctrl+g'.
        messages_last (Union[Unset, str]): Navigate to last message Default: 'ctrl+alt+g'.
        messages_copy (Union[Unset, str]): Copy message Default: '<leader>y'.
        messages_undo (Union[Unset, str]): Undo message Default: '<leader>u'.
        messages_redo (Union[Unset, str]): Redo message Default: '<leader>r'.
        model_list (Union[Unset, str]): List available models Default: '<leader>m'.
        model_cycle_recent (Union[Unset, str]): Next recent model Default: 'f2'.
        model_cycle_recent_reverse (Union[Unset, str]): Previous recent model Default: 'shift+f2'.
        agent_list (Union[Unset, str]): List agents Default: '<leader>a'.
        agent_cycle (Union[Unset, str]): Next agent Default: 'tab'.
        agent_cycle_reverse (Union[Unset, str]): Previous agent Default: 'shift+tab'.
        input_clear (Union[Unset, str]): Clear input field Default: 'ctrl+c'.
        input_paste (Union[Unset, str]): Paste from clipboard Default: 'ctrl+v'.
        input_submit (Union[Unset, str]): Submit input Default: 'enter'.
        input_newline (Union[Unset, str]): Insert newline in input Default: 'shift+enter,ctrl+j'.
        switch_mode (Union[Unset, str]): @deprecated use agent_cycle. Next mode Default: 'none'.
        switch_mode_reverse (Union[Unset, str]): @deprecated use agent_cycle_reverse. Previous mode Default: 'none'.
        switch_agent (Union[Unset, str]): @deprecated use agent_cycle. Next agent Default: 'tab'.
        switch_agent_reverse (Union[Unset, str]): @deprecated use agent_cycle_reverse. Previous agent Default:
            'shift+tab'.
        file_list (Union[Unset, str]): @deprecated Currently not available. List files Default: 'none'.
        file_close (Union[Unset, str]): @deprecated Close file Default: 'none'.
        file_search (Union[Unset, str]): @deprecated Search file Default: 'none'.
        file_diff_toggle (Union[Unset, str]): @deprecated Split/unified diff Default: 'none'.
        messages_previous (Union[Unset, str]): @deprecated Navigate to previous message Default: 'none'.
        messages_next (Union[Unset, str]): @deprecated Navigate to next message Default: 'none'.
        messages_layout_toggle (Union[Unset, str]): @deprecated Toggle layout Default: 'none'.
        messages_revert (Union[Unset, str]): @deprecated use messages_undo. Revert message Default: 'none'.
    """

    leader: Union[Unset, str] = "ctrl+x"
    app_help: Union[Unset, str] = "<leader>h"
    app_exit: Union[Unset, str] = "ctrl+c,<leader>q"
    editor_open: Union[Unset, str] = "<leader>e"
    theme_list: Union[Unset, str] = "<leader>t"
    project_init: Union[Unset, str] = "<leader>i"
    tool_details: Union[Unset, str] = "<leader>d"
    thinking_blocks: Union[Unset, str] = "<leader>b"
    session_export: Union[Unset, str] = "<leader>x"
    session_new: Union[Unset, str] = "<leader>n"
    session_list: Union[Unset, str] = "<leader>l"
    session_timeline: Union[Unset, str] = "<leader>g"
    session_share: Union[Unset, str] = "<leader>s"
    session_unshare: Union[Unset, str] = "none"
    session_interrupt: Union[Unset, str] = "esc"
    session_compact: Union[Unset, str] = "<leader>c"
    session_child_cycle: Union[Unset, str] = "<leader>right"
    session_child_cycle_reverse: Union[Unset, str] = "<leader>left"
    messages_page_up: Union[Unset, str] = "pgup"
    messages_page_down: Union[Unset, str] = "pgdown"
    messages_half_page_up: Union[Unset, str] = "ctrl+alt+u"
    messages_half_page_down: Union[Unset, str] = "ctrl+alt+d"
    messages_first: Union[Unset, str] = "ctrl+g"
    messages_last: Union[Unset, str] = "ctrl+alt+g"
    messages_copy: Union[Unset, str] = "<leader>y"
    messages_undo: Union[Unset, str] = "<leader>u"
    messages_redo: Union[Unset, str] = "<leader>r"
    model_list: Union[Unset, str] = "<leader>m"
    model_cycle_recent: Union[Unset, str] = "f2"
    model_cycle_recent_reverse: Union[Unset, str] = "shift+f2"
    agent_list: Union[Unset, str] = "<leader>a"
    agent_cycle: Union[Unset, str] = "tab"
    agent_cycle_reverse: Union[Unset, str] = "shift+tab"
    input_clear: Union[Unset, str] = "ctrl+c"
    input_paste: Union[Unset, str] = "ctrl+v"
    input_submit: Union[Unset, str] = "enter"
    input_newline: Union[Unset, str] = "shift+enter,ctrl+j"
    switch_mode: Union[Unset, str] = "none"
    switch_mode_reverse: Union[Unset, str] = "none"
    switch_agent: Union[Unset, str] = "tab"
    switch_agent_reverse: Union[Unset, str] = "shift+tab"
    file_list: Union[Unset, str] = "none"
    file_close: Union[Unset, str] = "none"
    file_search: Union[Unset, str] = "none"
    file_diff_toggle: Union[Unset, str] = "none"
    messages_previous: Union[Unset, str] = "none"
    messages_next: Union[Unset, str] = "none"
    messages_layout_toggle: Union[Unset, str] = "none"
    messages_revert: Union[Unset, str] = "none"

    def to_dict(self) -> dict[str, Any]:
        leader = self.leader

        app_help = self.app_help

        app_exit = self.app_exit

        editor_open = self.editor_open

        theme_list = self.theme_list

        project_init = self.project_init

        tool_details = self.tool_details

        thinking_blocks = self.thinking_blocks

        session_export = self.session_export

        session_new = self.session_new

        session_list = self.session_list

        session_timeline = self.session_timeline

        session_share = self.session_share

        session_unshare = self.session_unshare

        session_interrupt = self.session_interrupt

        session_compact = self.session_compact

        session_child_cycle = self.session_child_cycle

        session_child_cycle_reverse = self.session_child_cycle_reverse

        messages_page_up = self.messages_page_up

        messages_page_down = self.messages_page_down

        messages_half_page_up = self.messages_half_page_up

        messages_half_page_down = self.messages_half_page_down

        messages_first = self.messages_first

        messages_last = self.messages_last

        messages_copy = self.messages_copy

        messages_undo = self.messages_undo

        messages_redo = self.messages_redo

        model_list = self.model_list

        model_cycle_recent = self.model_cycle_recent

        model_cycle_recent_reverse = self.model_cycle_recent_reverse

        agent_list = self.agent_list

        agent_cycle = self.agent_cycle

        agent_cycle_reverse = self.agent_cycle_reverse

        input_clear = self.input_clear

        input_paste = self.input_paste

        input_submit = self.input_submit

        input_newline = self.input_newline

        switch_mode = self.switch_mode

        switch_mode_reverse = self.switch_mode_reverse

        switch_agent = self.switch_agent

        switch_agent_reverse = self.switch_agent_reverse

        file_list = self.file_list

        file_close = self.file_close

        file_search = self.file_search

        file_diff_toggle = self.file_diff_toggle

        messages_previous = self.messages_previous

        messages_next = self.messages_next

        messages_layout_toggle = self.messages_layout_toggle

        messages_revert = self.messages_revert

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if leader is not UNSET:
            field_dict["leader"] = leader
        if app_help is not UNSET:
            field_dict["app_help"] = app_help
        if app_exit is not UNSET:
            field_dict["app_exit"] = app_exit
        if editor_open is not UNSET:
            field_dict["editor_open"] = editor_open
        if theme_list is not UNSET:
            field_dict["theme_list"] = theme_list
        if project_init is not UNSET:
            field_dict["project_init"] = project_init
        if tool_details is not UNSET:
            field_dict["tool_details"] = tool_details
        if thinking_blocks is not UNSET:
            field_dict["thinking_blocks"] = thinking_blocks
        if session_export is not UNSET:
            field_dict["session_export"] = session_export
        if session_new is not UNSET:
            field_dict["session_new"] = session_new
        if session_list is not UNSET:
            field_dict["session_list"] = session_list
        if session_timeline is not UNSET:
            field_dict["session_timeline"] = session_timeline
        if session_share is not UNSET:
            field_dict["session_share"] = session_share
        if session_unshare is not UNSET:
            field_dict["session_unshare"] = session_unshare
        if session_interrupt is not UNSET:
            field_dict["session_interrupt"] = session_interrupt
        if session_compact is not UNSET:
            field_dict["session_compact"] = session_compact
        if session_child_cycle is not UNSET:
            field_dict["session_child_cycle"] = session_child_cycle
        if session_child_cycle_reverse is not UNSET:
            field_dict["session_child_cycle_reverse"] = session_child_cycle_reverse
        if messages_page_up is not UNSET:
            field_dict["messages_page_up"] = messages_page_up
        if messages_page_down is not UNSET:
            field_dict["messages_page_down"] = messages_page_down
        if messages_half_page_up is not UNSET:
            field_dict["messages_half_page_up"] = messages_half_page_up
        if messages_half_page_down is not UNSET:
            field_dict["messages_half_page_down"] = messages_half_page_down
        if messages_first is not UNSET:
            field_dict["messages_first"] = messages_first
        if messages_last is not UNSET:
            field_dict["messages_last"] = messages_last
        if messages_copy is not UNSET:
            field_dict["messages_copy"] = messages_copy
        if messages_undo is not UNSET:
            field_dict["messages_undo"] = messages_undo
        if messages_redo is not UNSET:
            field_dict["messages_redo"] = messages_redo
        if model_list is not UNSET:
            field_dict["model_list"] = model_list
        if model_cycle_recent is not UNSET:
            field_dict["model_cycle_recent"] = model_cycle_recent
        if model_cycle_recent_reverse is not UNSET:
            field_dict["model_cycle_recent_reverse"] = model_cycle_recent_reverse
        if agent_list is not UNSET:
            field_dict["agent_list"] = agent_list
        if agent_cycle is not UNSET:
            field_dict["agent_cycle"] = agent_cycle
        if agent_cycle_reverse is not UNSET:
            field_dict["agent_cycle_reverse"] = agent_cycle_reverse
        if input_clear is not UNSET:
            field_dict["input_clear"] = input_clear
        if input_paste is not UNSET:
            field_dict["input_paste"] = input_paste
        if input_submit is not UNSET:
            field_dict["input_submit"] = input_submit
        if input_newline is not UNSET:
            field_dict["input_newline"] = input_newline
        if switch_mode is not UNSET:
            field_dict["switch_mode"] = switch_mode
        if switch_mode_reverse is not UNSET:
            field_dict["switch_mode_reverse"] = switch_mode_reverse
        if switch_agent is not UNSET:
            field_dict["switch_agent"] = switch_agent
        if switch_agent_reverse is not UNSET:
            field_dict["switch_agent_reverse"] = switch_agent_reverse
        if file_list is not UNSET:
            field_dict["file_list"] = file_list
        if file_close is not UNSET:
            field_dict["file_close"] = file_close
        if file_search is not UNSET:
            field_dict["file_search"] = file_search
        if file_diff_toggle is not UNSET:
            field_dict["file_diff_toggle"] = file_diff_toggle
        if messages_previous is not UNSET:
            field_dict["messages_previous"] = messages_previous
        if messages_next is not UNSET:
            field_dict["messages_next"] = messages_next
        if messages_layout_toggle is not UNSET:
            field_dict["messages_layout_toggle"] = messages_layout_toggle
        if messages_revert is not UNSET:
            field_dict["messages_revert"] = messages_revert

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        leader = d.pop("leader", UNSET)

        app_help = d.pop("app_help", UNSET)

        app_exit = d.pop("app_exit", UNSET)

        editor_open = d.pop("editor_open", UNSET)

        theme_list = d.pop("theme_list", UNSET)

        project_init = d.pop("project_init", UNSET)

        tool_details = d.pop("tool_details", UNSET)

        thinking_blocks = d.pop("thinking_blocks", UNSET)

        session_export = d.pop("session_export", UNSET)

        session_new = d.pop("session_new", UNSET)

        session_list = d.pop("session_list", UNSET)

        session_timeline = d.pop("session_timeline", UNSET)

        session_share = d.pop("session_share", UNSET)

        session_unshare = d.pop("session_unshare", UNSET)

        session_interrupt = d.pop("session_interrupt", UNSET)

        session_compact = d.pop("session_compact", UNSET)

        session_child_cycle = d.pop("session_child_cycle", UNSET)

        session_child_cycle_reverse = d.pop("session_child_cycle_reverse", UNSET)

        messages_page_up = d.pop("messages_page_up", UNSET)

        messages_page_down = d.pop("messages_page_down", UNSET)

        messages_half_page_up = d.pop("messages_half_page_up", UNSET)

        messages_half_page_down = d.pop("messages_half_page_down", UNSET)

        messages_first = d.pop("messages_first", UNSET)

        messages_last = d.pop("messages_last", UNSET)

        messages_copy = d.pop("messages_copy", UNSET)

        messages_undo = d.pop("messages_undo", UNSET)

        messages_redo = d.pop("messages_redo", UNSET)

        model_list = d.pop("model_list", UNSET)

        model_cycle_recent = d.pop("model_cycle_recent", UNSET)

        model_cycle_recent_reverse = d.pop("model_cycle_recent_reverse", UNSET)

        agent_list = d.pop("agent_list", UNSET)

        agent_cycle = d.pop("agent_cycle", UNSET)

        agent_cycle_reverse = d.pop("agent_cycle_reverse", UNSET)

        input_clear = d.pop("input_clear", UNSET)

        input_paste = d.pop("input_paste", UNSET)

        input_submit = d.pop("input_submit", UNSET)

        input_newline = d.pop("input_newline", UNSET)

        switch_mode = d.pop("switch_mode", UNSET)

        switch_mode_reverse = d.pop("switch_mode_reverse", UNSET)

        switch_agent = d.pop("switch_agent", UNSET)

        switch_agent_reverse = d.pop("switch_agent_reverse", UNSET)

        file_list = d.pop("file_list", UNSET)

        file_close = d.pop("file_close", UNSET)

        file_search = d.pop("file_search", UNSET)

        file_diff_toggle = d.pop("file_diff_toggle", UNSET)

        messages_previous = d.pop("messages_previous", UNSET)

        messages_next = d.pop("messages_next", UNSET)

        messages_layout_toggle = d.pop("messages_layout_toggle", UNSET)

        messages_revert = d.pop("messages_revert", UNSET)

        keybinds_config = cls(
            leader=leader,
            app_help=app_help,
            app_exit=app_exit,
            editor_open=editor_open,
            theme_list=theme_list,
            project_init=project_init,
            tool_details=tool_details,
            thinking_blocks=thinking_blocks,
            session_export=session_export,
            session_new=session_new,
            session_list=session_list,
            session_timeline=session_timeline,
            session_share=session_share,
            session_unshare=session_unshare,
            session_interrupt=session_interrupt,
            session_compact=session_compact,
            session_child_cycle=session_child_cycle,
            session_child_cycle_reverse=session_child_cycle_reverse,
            messages_page_up=messages_page_up,
            messages_page_down=messages_page_down,
            messages_half_page_up=messages_half_page_up,
            messages_half_page_down=messages_half_page_down,
            messages_first=messages_first,
            messages_last=messages_last,
            messages_copy=messages_copy,
            messages_undo=messages_undo,
            messages_redo=messages_redo,
            model_list=model_list,
            model_cycle_recent=model_cycle_recent,
            model_cycle_recent_reverse=model_cycle_recent_reverse,
            agent_list=agent_list,
            agent_cycle=agent_cycle,
            agent_cycle_reverse=agent_cycle_reverse,
            input_clear=input_clear,
            input_paste=input_paste,
            input_submit=input_submit,
            input_newline=input_newline,
            switch_mode=switch_mode,
            switch_mode_reverse=switch_mode_reverse,
            switch_agent=switch_agent,
            switch_agent_reverse=switch_agent_reverse,
            file_list=file_list,
            file_close=file_close,
            file_search=file_search,
            file_diff_toggle=file_diff_toggle,
            messages_previous=messages_previous,
            messages_next=messages_next,
            messages_layout_toggle=messages_layout_toggle,
            messages_revert=messages_revert,
        )

        return keybinds_config
