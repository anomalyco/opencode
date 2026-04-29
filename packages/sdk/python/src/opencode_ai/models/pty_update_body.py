from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.pty_update_body_size import PtyUpdateBodySize


T = TypeVar("T", bound="PtyUpdateBody")


@_attrs_define
class PtyUpdateBody:
    """
    Attributes:
        title (str | Unset):
        size (PtyUpdateBodySize | Unset):
    """

    title: str | Unset = UNSET
    size: PtyUpdateBodySize | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.pty_update_body_size import PtyUpdateBodySize

        title = self.title

        size: dict[str, Any] | Unset = UNSET
        if not isinstance(self.size, Unset):
            size = self.size.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if title is not UNSET:
            field_dict["title"] = title
        if size is not UNSET:
            field_dict["size"] = size

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.pty_update_body_size import PtyUpdateBodySize

        d = dict(src_dict)
        title = d.pop("title", UNSET)

        _size = d.pop("size", UNSET)
        size: PtyUpdateBodySize | Unset
        if isinstance(_size, Unset):
            size = UNSET
        else:
            size = PtyUpdateBodySize.from_dict(_size)

        pty_update_body = cls(
            title=title,
            size=size,
        )

        pty_update_body.additional_properties = d
        return pty_update_body

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
