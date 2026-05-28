from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_tool_state_running_status import SessionMessageToolStateRunningStatus

if TYPE_CHECKING:
    from ..models.session_message_tool_state_running_input import SessionMessageToolStateRunningInput
    from ..models.session_message_tool_state_running_structured import SessionMessageToolStateRunningStructured
    from ..models.tool_file_content import ToolFileContent
    from ..models.tool_text_content import ToolTextContent


T = TypeVar("T", bound="SessionMessageToolStateRunning")


@_attrs_define
class SessionMessageToolStateRunning:
    """
    Attributes:
        status (SessionMessageToolStateRunningStatus):
        input_ (SessionMessageToolStateRunningInput):
        structured (SessionMessageToolStateRunningStructured):
        content (list[ToolFileContent | ToolTextContent]):
    """

    status: SessionMessageToolStateRunningStatus
    input_: SessionMessageToolStateRunningInput
    structured: SessionMessageToolStateRunningStructured
    content: list[ToolFileContent | ToolTextContent]

    def to_dict(self) -> dict[str, Any]:
        from ..models.tool_text_content import ToolTextContent

        status = self.status.value

        input_ = self.input_.to_dict()

        structured = self.structured.to_dict()

        content = []
        for content_item_data in self.content:
            content_item: dict[str, Any]
            if isinstance(content_item_data, ToolTextContent):
                content_item = content_item_data.to_dict()
            else:
                content_item = content_item_data.to_dict()

            content.append(content_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "input": input_,
                "structured": structured,
                "content": content,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_message_tool_state_running_input import SessionMessageToolStateRunningInput
        from ..models.session_message_tool_state_running_structured import SessionMessageToolStateRunningStructured
        from ..models.tool_file_content import ToolFileContent
        from ..models.tool_text_content import ToolTextContent

        d = dict(src_dict)
        status = SessionMessageToolStateRunningStatus(d.pop("status"))

        input_ = SessionMessageToolStateRunningInput.from_dict(d.pop("input"))

        structured = SessionMessageToolStateRunningStructured.from_dict(d.pop("structured"))

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

        session_message_tool_state_running = cls(
            status=status,
            input_=input_,
            structured=structured,
            content=content,
        )

        return session_message_tool_state_running
