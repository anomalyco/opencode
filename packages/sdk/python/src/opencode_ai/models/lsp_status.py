from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="LSPStatus")


@_attrs_define
class LSPStatus:
    """
    Attributes:
        id (str):
        name (str):
        root (str):
        status (Literal['connected'] | Literal['error']):
    """

    id: str
    name: str
    root: str
    status: Literal["connected"] | Literal["error"]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        root = self.root

        status: Literal["connected"] | Literal["error"]
        status = self.status

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "root": root,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        root = d.pop("root")

        def _parse_status(data: object) -> Literal["connected"] | Literal["error"]:
            status_type_0 = cast(Literal["connected"], data)
            if status_type_0 != "connected":
                raise ValueError(f"status_type_0 must match const 'connected', got '{status_type_0}'")
            return status_type_0
            status_type_1 = cast(Literal["error"], data)
            if status_type_1 != "error":
                raise ValueError(f"status_type_1 must match const 'error', got '{status_type_1}'")
            return status_type_1

        status = _parse_status(d.pop("status"))

        lsp_status = cls(
            id=id,
            name=name,
            root=root,
            status=status,
        )

        lsp_status.additional_properties = d
        return lsp_status

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
