from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ContextOverflowErrorData")


@_attrs_define
class ContextOverflowErrorData:
    """
    Attributes:
        message (str):
        response_body (str | Unset):
    """

    message: str
    response_body: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        response_body = self.response_body

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
            }
        )
        if response_body is not UNSET:
            field_dict["responseBody"] = response_body

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        response_body = d.pop("responseBody", UNSET)

        context_overflow_error_data = cls(
            message=message,
            response_body=response_body,
        )

        return context_overflow_error_data
