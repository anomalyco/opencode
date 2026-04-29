from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="MCPStatusNeedsClientRegistration")


@_attrs_define
class MCPStatusNeedsClientRegistration:
    """
    Attributes:
        status (Literal['needs_client_registration']):
        error (str):
    """

    status: Literal["needs_client_registration"]
    error: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        error = self.error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = cast(Literal["needs_client_registration"], d.pop("status"))
        if status != "needs_client_registration":
            raise ValueError(f"status must match const 'needs_client_registration', got '{status}'")

        error = d.pop("error")

        mcp_status_needs_client_registration = cls(
            status=status,
            error=error,
        )

        mcp_status_needs_client_registration.additional_properties = d
        return mcp_status_needs_client_registration

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
