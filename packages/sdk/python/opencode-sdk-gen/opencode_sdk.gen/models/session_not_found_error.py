from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_not_found_error_tag import SessionNotFoundErrorTag

T = TypeVar("T", bound="SessionNotFoundError")


@_attrs_define
class SessionNotFoundError:
    """
    Attributes:
        field_tag (SessionNotFoundErrorTag):
        session_id (str):
        message (str):
    """

    field_tag: SessionNotFoundErrorTag
    session_id: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        session_id = self.session_id

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "sessionID": session_id,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = SessionNotFoundErrorTag(d.pop("_tag"))

        session_id = d.pop("sessionID")

        message = d.pop("message")

        session_not_found_error = cls(
            field_tag=field_tag,
            session_id=session_id,
            message=message,
        )

        return session_not_found_error
