from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_question_replied_type import EventQuestionRepliedType

if TYPE_CHECKING:
    from ..models.question_replied import QuestionReplied


T = TypeVar("T", bound="EventQuestionReplied")


@_attrs_define
class EventQuestionReplied:
    """
    Attributes:
        id (str):
        type_ (EventQuestionRepliedType):
        properties (QuestionReplied):
    """

    id: str
    type_: EventQuestionRepliedType
    properties: QuestionReplied

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
        from ..models.question_replied import QuestionReplied

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventQuestionRepliedType(d.pop("type"))

        properties = QuestionReplied.from_dict(d.pop("properties"))

        event_question_replied = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_question_replied
