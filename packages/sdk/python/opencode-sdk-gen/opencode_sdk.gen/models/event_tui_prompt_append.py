from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_tui_prompt_append_type import EventTuiPromptAppendType

if TYPE_CHECKING:
    from ..models.event_tui_prompt_append_properties import EventTuiPromptAppendProperties


T = TypeVar("T", bound="EventTuiPromptAppend")


@_attrs_define
class EventTuiPromptAppend:
    """
    Attributes:
        id (str):
        type_ (EventTuiPromptAppendType):
        properties (EventTuiPromptAppendProperties):
    """

    id: str
    type_: EventTuiPromptAppendType
    properties: EventTuiPromptAppendProperties

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_.value

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_tui_prompt_append_properties import EventTuiPromptAppendProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventTuiPromptAppendType(d.pop("type"))

        properties = EventTuiPromptAppendProperties.from_dict(d.pop("properties"))

        event_tui_prompt_append = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_tui_prompt_append
