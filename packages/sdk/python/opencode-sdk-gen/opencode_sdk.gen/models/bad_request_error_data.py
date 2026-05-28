from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.bad_request_error_data_kind import BadRequestErrorDataKind
from ..types import UNSET, Unset

T = TypeVar("T", bound="BadRequestErrorData")


@_attrs_define
class BadRequestErrorData:
    """
    Attributes:
        message (str):
        kind (BadRequestErrorDataKind | Unset):
    """

    message: str
    kind: BadRequestErrorDataKind | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        kind: str | Unset = UNSET
        if not isinstance(self.kind, Unset):
            kind = self.kind.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "message": message,
            }
        )
        if kind is not UNSET:
            field_dict["kind"] = kind

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        _kind = d.pop("kind", UNSET)
        kind: BadRequestErrorDataKind | Unset
        if isinstance(_kind, Unset):
            kind = UNSET
        else:
            kind = BadRequestErrorDataKind(_kind)

        bad_request_error_data = cls(
            message=message,
            kind=kind,
        )

        bad_request_error_data.additional_properties = d
        return bad_request_error_data

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
