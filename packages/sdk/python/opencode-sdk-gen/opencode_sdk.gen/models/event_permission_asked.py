from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_permission_asked_type import EventPermissionAskedType

if TYPE_CHECKING:
    from ..models.permission_request import PermissionRequest


T = TypeVar("T", bound="EventPermissionAsked")


@_attrs_define
class EventPermissionAsked:
    """
    Attributes:
        id (str):
        type_ (EventPermissionAskedType):
        properties (PermissionRequest):
    """

    id: str
    type_: EventPermissionAskedType
    properties: PermissionRequest

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
        from ..models.permission_request import PermissionRequest

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventPermissionAskedType(d.pop("type"))

        properties = PermissionRequest.from_dict(d.pop("properties"))

        event_permission_asked = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_permission_asked
