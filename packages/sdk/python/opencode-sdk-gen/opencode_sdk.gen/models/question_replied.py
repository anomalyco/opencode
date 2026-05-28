from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="QuestionReplied")


@_attrs_define
class QuestionReplied:
    """
    Attributes:
        session_id (str):
        request_id (str):
        answers (list[list[str]]):
    """

    session_id: str
    request_id: str
    answers: list[list[str]]

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        request_id = self.request_id

        answers = []
        for answers_item_data in self.answers:
            answers_item = answers_item_data

            answers.append(answers_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionID": session_id,
                "requestID": request_id,
                "answers": answers,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionID")

        request_id = d.pop("requestID")

        answers = []
        _answers = d.pop("answers")
        for answers_item_data in _answers:
            answers_item = cast(list[str], answers_item_data)

            answers.append(answers_item)

        question_replied = cls(
            session_id=session_id,
            request_id=request_id,
            answers=answers,
        )

        return question_replied
