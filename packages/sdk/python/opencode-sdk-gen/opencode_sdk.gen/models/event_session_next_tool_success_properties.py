from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.event_session_next_tool_success_properties_provider import (
        EventSessionNextToolSuccessPropertiesProvider,
    )
    from ..models.event_session_next_tool_success_properties_structured import (
        EventSessionNextToolSuccessPropertiesStructured,
    )
    from ..models.tool_file_content import ToolFileContent
    from ..models.tool_text_content import ToolTextContent


T = TypeVar("T", bound="EventSessionNextToolSuccessProperties")


@_attrs_define
class EventSessionNextToolSuccessProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        call_id (str):
        structured (EventSessionNextToolSuccessPropertiesStructured):
        content (list[ToolFileContent | ToolTextContent]):
        provider (EventSessionNextToolSuccessPropertiesProvider):
    """

    timestamp: float
    session_id: str
    call_id: str
    structured: EventSessionNextToolSuccessPropertiesStructured
    content: list[ToolFileContent | ToolTextContent]
    provider: EventSessionNextToolSuccessPropertiesProvider

    def to_dict(self) -> dict[str, Any]:
        from ..models.tool_text_content import ToolTextContent

        timestamp = self.timestamp

        session_id = self.session_id

        call_id = self.call_id

        structured = self.structured.to_dict()

        content = []
        for content_item_data in self.content:
            content_item: dict[str, Any]
            if isinstance(content_item_data, ToolTextContent):
                content_item = content_item_data.to_dict()
            else:
                content_item = content_item_data.to_dict()

            content.append(content_item)

        provider = self.provider.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "callID": call_id,
                "structured": structured,
                "content": content,
                "provider": provider,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_session_next_tool_success_properties_provider import (
            EventSessionNextToolSuccessPropertiesProvider,
        )
        from ..models.event_session_next_tool_success_properties_structured import (
            EventSessionNextToolSuccessPropertiesStructured,
        )
        from ..models.tool_file_content import ToolFileContent
        from ..models.tool_text_content import ToolTextContent

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        call_id = d.pop("callID")

        structured = EventSessionNextToolSuccessPropertiesStructured.from_dict(d.pop("structured"))

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

        provider = EventSessionNextToolSuccessPropertiesProvider.from_dict(d.pop("provider"))

        event_session_next_tool_success_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            call_id=call_id,
            structured=structured,
            content=content,
            provider=provider,
        )

        return event_session_next_tool_success_properties
