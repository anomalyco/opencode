from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.question_not_found_error_tag import QuestionNotFoundErrorTag

T = TypeVar("T", bound="QuestionNotFoundError")


@_attrs_define
class QuestionNotFoundError:
    """
    Attributes:
        field_tag (QuestionNotFoundErrorTag):
        request_id (str):
        message (str):
    """

    field_tag: QuestionNotFoundErrorTag
    request_id: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        request_id = self.request_id

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "requestID": request_id,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = QuestionNotFoundErrorTag(d.pop("_tag"))

        request_id = d.pop("requestID")

        message = d.pop("message")

        question_not_found_error = cls(
            field_tag=field_tag,
            request_id=request_id,
            message=message,
        )

        return question_not_found_error
