from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_permission_replied_type import EventPermissionRepliedType

if TYPE_CHECKING:
    from ..models.event_permission_replied_properties import EventPermissionRepliedProperties


T = TypeVar("T", bound="EventPermissionReplied")


@_attrs_define
class EventPermissionReplied:
    """
    Attributes:
        id (str):
        type_ (EventPermissionRepliedType):
        properties (EventPermissionRepliedProperties):
    """

    id: str
    type_: EventPermissionRepliedType
    properties: EventPermissionRepliedProperties

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
        from ..models.event_permission_replied_properties import EventPermissionRepliedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventPermissionRepliedType(d.pop("type"))

        properties = EventPermissionRepliedProperties.from_dict(d.pop("properties"))

        event_permission_replied = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_permission_replied
