from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.output_format_json_schema import OutputFormatJsonSchema
    from ..models.output_format_text import OutputFormatText
    from ..models.user_message_model import UserMessageModel
    from ..models.user_message_summary import UserMessageSummary
    from ..models.user_message_time import UserMessageTime
    from ..models.user_message_tools import UserMessageTools


T = TypeVar("T", bound="UserMessage")


@_attrs_define
class UserMessage:
    """
    Attributes:
        id (str):
        session_id (str):
        role (Literal['user']):
        time (UserMessageTime):
        agent (str):
        model (UserMessageModel):
        format_ (OutputFormatJsonSchema | OutputFormatText | Unset):
        summary (UserMessageSummary | Unset):
        system (str | Unset):
        tools (UserMessageTools | Unset):
    """

    id: str
    session_id: str
    role: Literal["user"]
    time: UserMessageTime
    agent: str
    model: UserMessageModel
    format_: OutputFormatJsonSchema | OutputFormatText | Unset = UNSET
    summary: UserMessageSummary | Unset = UNSET
    system: str | Unset = UNSET
    tools: UserMessageTools | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.output_format_json_schema import OutputFormatJsonSchema
        from ..models.output_format_text import OutputFormatText
        from ..models.user_message_model import UserMessageModel
        from ..models.user_message_summary import UserMessageSummary
        from ..models.user_message_time import UserMessageTime
        from ..models.user_message_tools import UserMessageTools

        id = self.id

        session_id = self.session_id

        role = self.role

        time = self.time.to_dict()

        agent = self.agent

        model = self.model.to_dict()

        format_: dict[str, Any] | Unset
        if isinstance(self.format_, Unset):
            format_ = UNSET
        elif isinstance(self.format_, OutputFormatText):
            format_ = self.format_.to_dict()
        else:
            format_ = self.format_.to_dict()

        summary: dict[str, Any] | Unset = UNSET
        if not isinstance(self.summary, Unset):
            summary = self.summary.to_dict()

        system = self.system

        tools: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tools, Unset):
            tools = self.tools.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "role": role,
                "time": time,
                "agent": agent,
                "model": model,
            }
        )
        if format_ is not UNSET:
            field_dict["format"] = format_
        if summary is not UNSET:
            field_dict["summary"] = summary
        if system is not UNSET:
            field_dict["system"] = system
        if tools is not UNSET:
            field_dict["tools"] = tools

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.output_format_json_schema import OutputFormatJsonSchema
        from ..models.output_format_text import OutputFormatText
        from ..models.user_message_model import UserMessageModel
        from ..models.user_message_summary import UserMessageSummary
        from ..models.user_message_time import UserMessageTime
        from ..models.user_message_tools import UserMessageTools

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        role = cast(Literal["user"], d.pop("role"))
        if role != "user":
            raise ValueError(f"role must match const 'user', got '{role}'")

        time = UserMessageTime.from_dict(d.pop("time"))

        agent = d.pop("agent")

        model = UserMessageModel.from_dict(d.pop("model"))

        def _parse_format_(data: object) -> OutputFormatJsonSchema | OutputFormatText | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_output_format_type_0 = OutputFormatText.from_dict(data)

                return componentsschemas_output_format_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_output_format_type_1 = OutputFormatJsonSchema.from_dict(data)

            return componentsschemas_output_format_type_1

        format_ = _parse_format_(d.pop("format", UNSET))

        _summary = d.pop("summary", UNSET)
        summary: UserMessageSummary | Unset
        if isinstance(_summary, Unset):
            summary = UNSET
        else:
            summary = UserMessageSummary.from_dict(_summary)

        system = d.pop("system", UNSET)

        _tools = d.pop("tools", UNSET)
        tools: UserMessageTools | Unset
        if isinstance(_tools, Unset):
            tools = UNSET
        else:
            tools = UserMessageTools.from_dict(_tools)

        user_message = cls(
            id=id,
            session_id=session_id,
            role=role,
            time=time,
            agent=agent,
            model=model,
            format_=format_,
            summary=summary,
            system=system,
            tools=tools,
        )

        user_message.additional_properties = d
        return user_message

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
