from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.question_replied import QuestionReplied


T = TypeVar("T", bound="EventQuestionReplied")


@_attrs_define
class EventQuestionReplied:
    """
    Attributes:
        type_ (Literal['question.replied']):
        properties (QuestionReplied):
    """

    type_: Literal["question.replied"]
    properties: QuestionReplied
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.question_replied import QuestionReplied

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
        from ..models.question_replied import QuestionReplied

        d = dict(src_dict)
        type_ = cast(Literal["question.replied"], d.pop("type"))
        if type_ != "question.replied":
            raise ValueError(f"type must match const 'question.replied', got '{type_}'")

        properties = QuestionReplied.from_dict(d.pop("properties"))

        event_question_replied = cls(
            type_=type_,
            properties=properties,
        )

        event_question_replied.additional_properties = d
        return event_question_replied

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
