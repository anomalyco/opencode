from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="UnknownErrorData")


@_attrs_define
class UnknownErrorData:
    """
    Attributes:
        message (str):
        ref (str | Unset):
    """

    message: str
    ref: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        ref = self.ref

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
            }
        )
        if ref is not UNSET:
            field_dict["ref"] = ref

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        ref = d.pop("ref", UNSET)

        unknown_error_data = cls(
            message=message,
            ref=ref,
        )

        return unknown_error_data
