from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_tool_state_completed_status import SessionMessageToolStateCompletedStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.prompt_file_attachment import PromptFileAttachment
    from ..models.session_message_tool_state_completed_input import SessionMessageToolStateCompletedInput
    from ..models.session_message_tool_state_completed_structured import SessionMessageToolStateCompletedStructured
    from ..models.tool_file_content import ToolFileContent
    from ..models.tool_text_content import ToolTextContent


T = TypeVar("T", bound="SessionMessageToolStateCompleted")


@_attrs_define
class SessionMessageToolStateCompleted:
    """
    Attributes:
        status (SessionMessageToolStateCompletedStatus):
        input_ (SessionMessageToolStateCompletedInput):
        content (list[ToolFileContent | ToolTextContent]):
        structured (SessionMessageToolStateCompletedStructured):
        attachments (list[PromptFileAttachment] | Unset):
    """

    status: SessionMessageToolStateCompletedStatus
    input_: SessionMessageToolStateCompletedInput
    content: list[ToolFileContent | ToolTextContent]
    structured: SessionMessageToolStateCompletedStructured
    attachments: list[PromptFileAttachment] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.tool_text_content import ToolTextContent

        status = self.status.value

        input_ = self.input_.to_dict()

        content = []
        for content_item_data in self.content:
            content_item: dict[str, Any]
            if isinstance(content_item_data, ToolTextContent):
                content_item = content_item_data.to_dict()
            else:
                content_item = content_item_data.to_dict()

            content.append(content_item)

        structured = self.structured.to_dict()

        attachments: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.attachments, Unset):
            attachments = []
            for attachments_item_data in self.attachments:
                attachments_item = attachments_item_data.to_dict()
                attachments.append(attachments_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "input": input_,
                "content": content,
                "structured": structured,
            }
        )
        if attachments is not UNSET:
            field_dict["attachments"] = attachments

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.prompt_file_attachment import PromptFileAttachment
        from ..models.session_message_tool_state_completed_input import SessionMessageToolStateCompletedInput
        from ..models.session_message_tool_state_completed_structured import SessionMessageToolStateCompletedStructured
        from ..models.tool_file_content import ToolFileContent
        from ..models.tool_text_content import ToolTextContent

        d = dict(src_dict)
        status = SessionMessageToolStateCompletedStatus(d.pop("status"))

        input_ = SessionMessageToolStateCompletedInput.from_dict(d.pop("input"))

        content = []
        _content = d.pop("content")
        for content_item_data in _content:

            def _parse_content_item(data: object) -> ToolFileContent | ToolTextContent:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    content_item_type_0 = ToolTextContent.from_dict(data)

                    return content_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                content_item_type_1 = ToolFileContent.from_dict(data)

                return content_item_type_1

            content_item = _parse_content_item(content_item_data)

            content.append(content_item)

        structured = SessionMessageToolStateCompletedStructured.from_dict(d.pop("structured"))

        _attachments = d.pop("attachments", UNSET)
        attachments: list[PromptFileAttachment] | Unset = UNSET
        if _attachments is not UNSET:
            attachments = []
            for attachments_item_data in _attachments:
                attachments_item = PromptFileAttachment.from_dict(attachments_item_data)

                attachments.append(attachments_item)

        session_message_tool_state_completed = cls(
            status=status,
            input_=input_,
            content=content,
            structured=structured,
            attachments=attachments,
        )

        return session_message_tool_state_completed
