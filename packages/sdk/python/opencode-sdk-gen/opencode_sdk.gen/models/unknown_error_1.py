from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.unknown_error_1_tag import UnknownError1Tag
from ..types import UNSET, Unset

T = TypeVar("T", bound="UnknownError1")


@_attrs_define
class UnknownError1:
    """
    Attributes:
        field_tag (UnknownError1Tag):
        message (str):
        ref (str | Unset):
    """

    field_tag: UnknownError1Tag
    message: str
    ref: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        message = self.message

        ref = self.ref

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "message": message,
            }
        )
        if ref is not UNSET:
            field_dict["ref"] = ref

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = UnknownError1Tag(d.pop("_tag"))

        message = d.pop("message")

        ref = d.pop("ref", UNSET)

        unknown_error_1 = cls(
            field_tag=field_tag,
            message=message,
            ref=ref,
        )

        return unknown_error_1
