from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.question_info import QuestionInfo
    from ..models.question_tool import QuestionTool


T = TypeVar("T", bound="QuestionRequest")


@_attrs_define
class QuestionRequest:
    """
    Attributes:
        id (str):
        session_id (str):
        questions (list[QuestionInfo]): Questions to ask
        tool (QuestionTool | Unset):
    """

    id: str
    session_id: str
    questions: list[QuestionInfo]
    tool: QuestionTool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        questions = []
        for questions_item_data in self.questions:
            questions_item = questions_item_data.to_dict()
            questions.append(questions_item)

        tool: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool, Unset):
            tool = self.tool.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "questions": questions,
            }
        )
        if tool is not UNSET:
            field_dict["tool"] = tool

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.question_info import QuestionInfo
        from ..models.question_tool import QuestionTool

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        questions = []
        _questions = d.pop("questions")
        for questions_item_data in _questions:
            questions_item = QuestionInfo.from_dict(questions_item_data)

            questions.append(questions_item)

        _tool = d.pop("tool", UNSET)
        tool: QuestionTool | Unset
        if isinstance(_tool, Unset):
            tool = UNSET
        else:
            tool = QuestionTool.from_dict(_tool)

        question_request = cls(
            id=id,
            session_id=session_id,
            questions=questions,
            tool=tool,
        )

        return question_request
