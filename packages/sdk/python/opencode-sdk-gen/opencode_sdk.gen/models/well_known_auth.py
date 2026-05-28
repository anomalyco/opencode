from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.well_known_auth_type import WellKnownAuthType

T = TypeVar("T", bound="WellKnownAuth")


@_attrs_define
class WellKnownAuth:
    """
    Attributes:
        type_ (WellKnownAuthType):
        key (str):
        token (str):
    """

    type_: WellKnownAuthType
    key: str
    token: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        key = self.key

        token = self.token

        field_dict: dict[str, Any] = {}

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
        type_ = WellKnownAuthType(d.pop("type"))

        key = d.pop("key")

        token = d.pop("token")

        well_known_auth = cls(
            type_=type_,
            key=key,
            token=token,
        )

        return well_known_auth
