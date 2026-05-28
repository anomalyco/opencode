from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.invalid_request_error_tag import InvalidRequestErrorTag
from ..types import UNSET, Unset

T = TypeVar("T", bound="InvalidRequestError")


@_attrs_define
class InvalidRequestError:
    """
    Attributes:
        field_tag (InvalidRequestErrorTag):
        message (str):
        kind (str | Unset):
        field (str | Unset):
    """

    field_tag: InvalidRequestErrorTag
    message: str
    kind: str | Unset = UNSET
    field: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        message = self.message

        kind = self.kind

        field = self.field

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "message": message,
            }
        )
        if kind is not UNSET:
            field_dict["kind"] = kind
        if field is not UNSET:
            field_dict["field"] = field

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = InvalidRequestErrorTag(d.pop("_tag"))

        message = d.pop("message")

        kind = d.pop("kind", UNSET)

        field = d.pop("field", UNSET)

        invalid_request_error = cls(
            field_tag=field_tag,
            message=message,
            kind=kind,
            field=field,
        )

        return invalid_request_error
