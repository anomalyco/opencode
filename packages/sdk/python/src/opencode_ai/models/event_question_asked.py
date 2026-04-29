from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.question_request import QuestionRequest


T = TypeVar("T", bound="EventQuestionAsked")


@_attrs_define
class EventQuestionAsked:
    """
    Attributes:
        type_ (Literal['question.asked']):
        properties (QuestionRequest):
    """

    type_: Literal["question.asked"]
    properties: QuestionRequest
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.question_request import QuestionRequest

        type_ = self.type_

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.question_request import QuestionRequest

        d = dict(src_dict)
        type_ = cast(Literal["question.asked"], d.pop("type"))
        if type_ != "question.asked":
            raise ValueError(f"type must match const 'question.asked', got '{type_}'")

        properties = QuestionRequest.from_dict(d.pop("properties"))

        event_question_asked = cls(
            type_=type_,
            properties=properties,
        )

        event_question_asked.additional_properties = d
        return event_question_asked

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
