from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_part_input import AgentPartInput
    from ..models.file_part_input import FilePartInput
    from ..models.output_format_json_schema import OutputFormatJsonSchema
    from ..models.output_format_text import OutputFormatText
    from ..models.session_prompt_body_model import SessionPromptBodyModel
    from ..models.session_prompt_body_tools import SessionPromptBodyTools
    from ..models.subtask_part_input import SubtaskPartInput
    from ..models.text_part_input import TextPartInput


T = TypeVar("T", bound="SessionPromptBody")


@_attrs_define
class SessionPromptBody:
    """
    Attributes:
        parts (list[AgentPartInput | FilePartInput | SubtaskPartInput | TextPartInput]):
        message_id (str | Unset):
        model (SessionPromptBodyModel | Unset):
        agent (str | Unset):
        no_reply (bool | Unset):
        tools (SessionPromptBodyTools | Unset):
        format_ (OutputFormatJsonSchema | OutputFormatText | Unset):
        system (str | Unset):
        variant (str | Unset):
    """

    parts: list[AgentPartInput | FilePartInput | SubtaskPartInput | TextPartInput]
    message_id: str | Unset = UNSET
    model: SessionPromptBodyModel | Unset = UNSET
    agent: str | Unset = UNSET
    no_reply: bool | Unset = UNSET
    tools: SessionPromptBodyTools | Unset = UNSET
    format_: OutputFormatJsonSchema | OutputFormatText | Unset = UNSET
    system: str | Unset = UNSET
    variant: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_part_input import AgentPartInput
        from ..models.file_part_input import FilePartInput
        from ..models.output_format_text import OutputFormatText
        from ..models.text_part_input import TextPartInput

        parts = []
        for parts_item_data in self.parts:
            parts_item: dict[str, Any]
            if isinstance(parts_item_data, TextPartInput):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, FilePartInput):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, AgentPartInput):
                parts_item = parts_item_data.to_dict()
            else:
                parts_item = parts_item_data.to_dict()

            parts.append(parts_item)

        message_id = self.message_id

        model: dict[str, Any] | Unset = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        agent = self.agent

        no_reply = self.no_reply

        tools: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tools, Unset):
            tools = self.tools.to_dict()

        format_: dict[str, Any] | Unset
        if isinstance(self.format_, Unset):
            format_ = UNSET
        elif isinstance(self.format_, OutputFormatText):
            format_ = self.format_.to_dict()
        else:
            format_ = self.format_.to_dict()

        system = self.system

        variant = self.variant

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "parts": parts,
            }
        )
        if message_id is not UNSET:
            field_dict["messageID"] = message_id
        if model is not UNSET:
            field_dict["model"] = model
        if agent is not UNSET:
            field_dict["agent"] = agent
        if no_reply is not UNSET:
            field_dict["noReply"] = no_reply
        if tools is not UNSET:
            field_dict["tools"] = tools
        if format_ is not UNSET:
            field_dict["format"] = format_
        if system is not UNSET:
            field_dict["system"] = system
        if variant is not UNSET:
            field_dict["variant"] = variant

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_part_input import AgentPartInput
        from ..models.file_part_input import FilePartInput
        from ..models.output_format_json_schema import OutputFormatJsonSchema
        from ..models.output_format_text import OutputFormatText
        from ..models.session_prompt_body_model import SessionPromptBodyModel
        from ..models.session_prompt_body_tools import SessionPromptBodyTools
        from ..models.subtask_part_input import SubtaskPartInput
        from ..models.text_part_input import TextPartInput

        d = dict(src_dict)
        parts = []
        _parts = d.pop("parts")
        for parts_item_data in _parts:

            def _parse_parts_item(data: object) -> AgentPartInput | FilePartInput | SubtaskPartInput | TextPartInput:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    parts_item_type_0 = TextPartInput.from_dict(data)

                    return parts_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    parts_item_type_1 = FilePartInput.from_dict(data)

                    return parts_item_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    parts_item_type_2 = AgentPartInput.from_dict(data)

                    return parts_item_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                parts_item_type_3 = SubtaskPartInput.from_dict(data)

                return parts_item_type_3

            parts_item = _parse_parts_item(parts_item_data)

            parts.append(parts_item)

        message_id = d.pop("messageID", UNSET)

        _model = d.pop("model", UNSET)
        model: SessionPromptBodyModel | Unset
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = SessionPromptBodyModel.from_dict(_model)

        agent = d.pop("agent", UNSET)

        no_reply = d.pop("noReply", UNSET)

        _tools = d.pop("tools", UNSET)
        tools: SessionPromptBodyTools | Unset
        if isinstance(_tools, Unset):
            tools = UNSET
        else:
            tools = SessionPromptBodyTools.from_dict(_tools)

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

        system = d.pop("system", UNSET)

        variant = d.pop("variant", UNSET)

        session_prompt_body = cls(
            parts=parts,
            message_id=message_id,
            model=model,
            agent=agent,
            no_reply=no_reply,
            tools=tools,
            format_=format_,
            system=system,
            variant=variant,
        )

        return session_prompt_body
