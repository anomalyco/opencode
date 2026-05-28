from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_lsp_updated_type import EventLspUpdatedType

if TYPE_CHECKING:
    from ..models.event_lsp_updated_properties import EventLspUpdatedProperties


T = TypeVar("T", bound="EventLspUpdated")


@_attrs_define
class EventLspUpdated:
    """
    Attributes:
        id (str):
        type_ (EventLspUpdatedType):
        properties (EventLspUpdatedProperties):
    """

    id: str
    type_: EventLspUpdatedType
    properties: EventLspUpdatedProperties

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
        from ..models.event_lsp_updated_properties import EventLspUpdatedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventLspUpdatedType(d.pop("type"))

        properties = EventLspUpdatedProperties.from_dict(d.pop("properties"))

        event_lsp_updated = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_lsp_updated
