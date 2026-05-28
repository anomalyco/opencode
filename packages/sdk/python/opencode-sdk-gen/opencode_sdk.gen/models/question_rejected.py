from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="QuestionRejected")


@_attrs_define
class QuestionRejected:
    """
    Attributes:
        session_id (str):
        request_id (str):
    """

    session_id: str
    request_id: str

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        request_id = self.request_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionID": session_id,
                "requestID": request_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionID")

        request_id = d.pop("requestID")

        question_rejected = cls(
            session_id=session_id,
            request_id=request_id,
        )

        return question_rejected
