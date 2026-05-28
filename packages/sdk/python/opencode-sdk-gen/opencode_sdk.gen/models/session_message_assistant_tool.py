from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_assistant_tool_type import SessionMessageAssistantToolType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_message_assistant_tool_provider import SessionMessageAssistantToolProvider
    from ..models.session_message_assistant_tool_time import SessionMessageAssistantToolTime
    from ..models.session_message_tool_state_completed import SessionMessageToolStateCompleted
    from ..models.session_message_tool_state_error import SessionMessageToolStateError
    from ..models.session_message_tool_state_pending import SessionMessageToolStatePending
    from ..models.session_message_tool_state_running import SessionMessageToolStateRunning


T = TypeVar("T", bound="SessionMessageAssistantTool")


@_attrs_define
class SessionMessageAssistantTool:
    """
    Attributes:
        type_ (SessionMessageAssistantToolType):
        id (str):
        name (str):
        state (SessionMessageToolStateCompleted | SessionMessageToolStateError | SessionMessageToolStatePending |
            SessionMessageToolStateRunning):
        time (SessionMessageAssistantToolTime):
        provider (SessionMessageAssistantToolProvider | Unset):
    """

    type_: SessionMessageAssistantToolType
    id: str
    name: str
    state: (
        SessionMessageToolStateCompleted
        | SessionMessageToolStateError
        | SessionMessageToolStatePending
        | SessionMessageToolStateRunning
    )
    time: SessionMessageAssistantToolTime
    provider: SessionMessageAssistantToolProvider | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.session_message_tool_state_completed import SessionMessageToolStateCompleted
        from ..models.session_message_tool_state_pending import SessionMessageToolStatePending
        from ..models.session_message_tool_state_running import SessionMessageToolStateRunning

        type_ = self.type_.value

        id = self.id

        name = self.name

        state: dict[str, Any]
        if isinstance(self.state, SessionMessageToolStatePending):
            state = self.state.to_dict()
        elif isinstance(self.state, SessionMessageToolStateRunning):
            state = self.state.to_dict()
        elif isinstance(self.state, SessionMessageToolStateCompleted):
            state = self.state.to_dict()
        else:
            state = self.state.to_dict()

        time = self.time.to_dict()

        provider: dict[str, Any] | Unset = UNSET
        if not isinstance(self.provider, Unset):
            provider = self.provider.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "id": id,
                "name": name,
                "state": state,
                "time": time,
            }
        )
        if provider is not UNSET:
            field_dict["provider"] = provider

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_message_assistant_tool_provider import SessionMessageAssistantToolProvider
        from ..models.session_message_assistant_tool_time import SessionMessageAssistantToolTime
        from ..models.session_message_tool_state_completed import SessionMessageToolStateCompleted
        from ..models.session_message_tool_state_error import SessionMessageToolStateError
        from ..models.session_message_tool_state_pending import SessionMessageToolStatePending
        from ..models.session_message_tool_state_running import SessionMessageToolStateRunning

        d = dict(src_dict)
        type_ = SessionMessageAssistantToolType(d.pop("type"))

        id = d.pop("id")

        name = d.pop("name")

        def _parse_state(
            data: object,
        ) -> (
            SessionMessageToolStateCompleted
            | SessionMessageToolStateError
            | SessionMessageToolStatePending
            | SessionMessageToolStateRunning
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                state_type_0 = SessionMessageToolStatePending.from_dict(data)

                return state_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                state_type_1 = SessionMessageToolStateRunning.from_dict(data)

                return state_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                state_type_2 = SessionMessageToolStateCompleted.from_dict(data)

                return state_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            state_type_3 = SessionMessageToolStateError.from_dict(data)

            return state_type_3

        state = _parse_state(d.pop("state"))

        time = SessionMessageAssistantToolTime.from_dict(d.pop("time"))

        _provider = d.pop("provider", UNSET)
        provider: SessionMessageAssistantToolProvider | Unset
        if isinstance(_provider, Unset):
            provider = UNSET
        else:
            provider = SessionMessageAssistantToolProvider.from_dict(_provider)

        session_message_assistant_tool = cls(
            type_=type_,
            id=id,
            name=name,
            state=state,
            time=time,
            provider=provider,
        )

        return session_message_assistant_tool
