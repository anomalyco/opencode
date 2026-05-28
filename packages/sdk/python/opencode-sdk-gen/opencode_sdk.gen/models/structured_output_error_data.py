from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="StructuredOutputErrorData")


@_attrs_define
class StructuredOutputErrorData:
    """
    Attributes:
        message (str):
        retries (int):
    """

    message: str
    retries: int

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        retries = self.retries

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
                "retries": retries,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        retries = d.pop("retries")

        structured_output_error_data = cls(
            message=message,
            retries=retries,
        )

        return structured_output_error_data
