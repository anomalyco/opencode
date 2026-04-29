from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.permission_request import PermissionRequest


T = TypeVar("T", bound="EventPermissionAsked")


@_attrs_define
class EventPermissionAsked:
    """
    Attributes:
        type_ (Literal['permission.asked']):
        properties (PermissionRequest):
    """

    type_: Literal["permission.asked"]
    properties: PermissionRequest
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.permission_request import PermissionRequest

        type_ = self.type_

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_request import PermissionRequest

        d = dict(src_dict)
        type_ = cast(Literal["permission.asked"], d.pop("type"))
        if type_ != "permission.asked":
            raise ValueError(f"type must match const 'permission.asked', got '{type_}'")

        properties = PermissionRequest.from_dict(d.pop("properties"))

        event_permission_asked = cls(
            type_=type_,
            properties=properties,
        )

        event_permission_asked.additional_properties = d
        return event_permission_asked

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
