from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_tool_state_error_status import SessionMessageToolStateErrorStatus

if TYPE_CHECKING:
    from ..models.session_error_unknown import SessionErrorUnknown
    from ..models.session_message_tool_state_error_input import SessionMessageToolStateErrorInput
    from ..models.session_message_tool_state_error_structured import SessionMessageToolStateErrorStructured
    from ..models.tool_file_content import ToolFileContent
    from ..models.tool_text_content import ToolTextContent


T = TypeVar("T", bound="SessionMessageToolStateError")


@_attrs_define
class SessionMessageToolStateError:
    """
    Attributes:
        status (SessionMessageToolStateErrorStatus):
        input_ (SessionMessageToolStateErrorInput):
        content (list[ToolFileContent | ToolTextContent]):
        structured (SessionMessageToolStateErrorStructured):
        error (SessionErrorUnknown):
    """

    status: SessionMessageToolStateErrorStatus
    input_: SessionMessageToolStateErrorInput
    content: list[ToolFileContent | ToolTextContent]
    structured: SessionMessageToolStateErrorStructured
    error: SessionErrorUnknown

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

        error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "input": input_,
                "content": content,
                "structured": structured,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_error_unknown import SessionErrorUnknown
        from ..models.session_message_tool_state_error_input import SessionMessageToolStateErrorInput
        from ..models.session_message_tool_state_error_structured import SessionMessageToolStateErrorStructured
        from ..models.tool_file_content import ToolFileContent
        from ..models.tool_text_content import ToolTextContent

        d = dict(src_dict)
        status = SessionMessageToolStateErrorStatus(d.pop("status"))

        input_ = SessionMessageToolStateErrorInput.from_dict(d.pop("input"))

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

        structured = SessionMessageToolStateErrorStructured.from_dict(d.pop("structured"))

        error = SessionErrorUnknown.from_dict(d.pop("error"))

        session_message_tool_state_error = cls(
            status=status,
            input_=input_,
            content=content,
            structured=structured,
            error=error,
        )

        return session_message_tool_state_error
