from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_question_rejected_type import EventQuestionRejectedType

if TYPE_CHECKING:
    from ..models.question_rejected import QuestionRejected


T = TypeVar("T", bound="EventQuestionRejected")


@_attrs_define
class EventQuestionRejected:
    """
    Attributes:
        id (str):
        type_ (EventQuestionRejectedType):
        properties (QuestionRejected):
    """

    id: str
    type_: EventQuestionRejectedType
    properties: QuestionRejected

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
        from ..models.question_rejected import QuestionRejected

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventQuestionRejectedType(d.pop("type"))

        properties = QuestionRejected.from_dict(d.pop("properties"))

        event_question_rejected = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_question_rejected
