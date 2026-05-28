from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="QuestionReplyBody")


@_attrs_define
class QuestionReplyBody:
    """
    Attributes:
        answers (list[list[str]]): User answers in order of questions (each answer is an array of selected labels)
    """

    answers: list[list[str]]

    def to_dict(self) -> dict[str, Any]:
        answers = []
        for answers_item_data in self.answers:
            answers_item = answers_item_data

            answers.append(answers_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "answers": answers,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        answers = []
        _answers = d.pop("answers")
        for answers_item_data in _answers:
            answers_item = cast(list[str], answers_item_data)

            answers.append(answers_item)

        question_reply_body = cls(
            answers=answers,
        )

        return question_reply_body
