from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_question_asked_type import EventQuestionAskedType

if TYPE_CHECKING:
    from ..models.question_request import QuestionRequest


T = TypeVar("T", bound="EventQuestionAsked")


@_attrs_define
class EventQuestionAsked:
    """
    Attributes:
        id (str):
        type_ (EventQuestionAskedType):
        properties (QuestionRequest):
    """

    id: str
    type_: EventQuestionAskedType
    properties: QuestionRequest

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_.value

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.question_request import QuestionRequest

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventQuestionAskedType(d.pop("type"))

        properties = QuestionRequest.from_dict(d.pop("properties"))

        event_question_asked = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_question_asked
