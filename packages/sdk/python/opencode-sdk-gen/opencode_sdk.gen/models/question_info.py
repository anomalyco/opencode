from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.question_option import QuestionOption


T = TypeVar("T", bound="QuestionInfo")


@_attrs_define
class QuestionInfo:
    """
    Attributes:
        question (str): Complete question
        header (str): Very short label (max 30 chars)
        options (list[QuestionOption]): Available choices
        multiple (bool | Unset):
        custom (bool | Unset):
    """

    question: str
    header: str
    options: list[QuestionOption]
    multiple: bool | Unset = UNSET
    custom: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        question = self.question

        header = self.header

        options = []
        for options_item_data in self.options:
            options_item = options_item_data.to_dict()
            options.append(options_item)

        multiple = self.multiple

        custom = self.custom

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "question": question,
                "header": header,
                "options": options,
            }
        )
        if multiple is not UNSET:
            field_dict["multiple"] = multiple
        if custom is not UNSET:
            field_dict["custom"] = custom

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.question_option import QuestionOption

        d = dict(src_dict)
        question = d.pop("question")

        header = d.pop("header")

        options = []
        _options = d.pop("options")
        for options_item_data in _options:
            options_item = QuestionOption.from_dict(options_item_data)

            options.append(options_item)

        multiple = d.pop("multiple", UNSET)

        custom = d.pop("custom", UNSET)

        question_info = cls(
            question=question,
            header=header,
            options=options,
            multiple=multiple,
            custom=custom,
        )

        return question_info
