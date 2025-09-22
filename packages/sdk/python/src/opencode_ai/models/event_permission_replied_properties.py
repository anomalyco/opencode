from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="EventPermissionRepliedProperties")


@_attrs_define
class EventPermissionRepliedProperties:
    """
    Attributes:
        session_id (str):
        permission_id (str):
        response (str):
    """

    session_id: str
    permission_id: str
    response: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        permission_id = self.permission_id

        response = self.response

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionID": session_id,
                "permissionID": permission_id,
                "response": response,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionID")

        permission_id = d.pop("permissionID")

        response = d.pop("response")

        event_permission_replied_properties = cls(
            session_id=session_id,
            permission_id=permission_id,
            response=response,
        )

        event_permission_replied_properties.additional_properties = d
        return event_permission_replied_properties

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
