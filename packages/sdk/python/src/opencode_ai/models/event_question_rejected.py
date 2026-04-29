from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.question_rejected import QuestionRejected


T = TypeVar("T", bound="EventQuestionRejected")


@_attrs_define
class EventQuestionRejected:
    """
    Attributes:
        type_ (Literal['question.rejected']):
        properties (QuestionRejected):
    """

    type_: Literal["question.rejected"]
    properties: QuestionRejected
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.question_rejected import QuestionRejected

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
        from ..models.question_rejected import QuestionRejected

        d = dict(src_dict)
        type_ = cast(Literal["question.rejected"], d.pop("type"))
        if type_ != "question.rejected":
            raise ValueError(f"type must match const 'question.rejected', got '{type_}'")

        properties = QuestionRejected.from_dict(d.pop("properties"))

        event_question_rejected = cls(
            type_=type_,
            properties=properties,
        )

        event_question_rejected.additional_properties = d
        return event_question_rejected

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
