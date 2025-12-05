from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="WellKnownAuth")


@_attrs_define
class WellKnownAuth:
    """
    Attributes:
        type_ (Literal['wellknown']):
        key (str):
        token (str):
    """

    type_: Literal["wellknown"]
    key: str
    token: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        key = self.key

        token = self.token

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "key": key,
                "token": token,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["wellknown"], d.pop("type"))
        if type_ != "wellknown":
            raise ValueError(f"type must match const 'wellknown', got '{type_}'")

        key = d.pop("key")

        token = d.pop("token")

        well_known_auth = cls(
            type_=type_,
            key=key,
            token=token,
        )

        well_known_auth.additional_properties = d
        return well_known_auth

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
