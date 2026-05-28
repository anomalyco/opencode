from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="MessageAbortedErrorData")


@_attrs_define
class MessageAbortedErrorData:
    """
    Attributes:
        message (str):
    """

    message: str

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        message_aborted_error_data = cls(
            message=message,
        )

        return message_aborted_error_data
