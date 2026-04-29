from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        request_id = self.request_id

        answers = []
        for answers_item_data in self.answers:
            answers_item = answers_item_data

            answers.append(answers_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        question_replied.additional_properties = d
        return question_replied

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
