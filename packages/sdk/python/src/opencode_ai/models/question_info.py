from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        multiple (bool | Unset): Allow selecting multiple choices
        custom (bool | Unset): Allow typing a custom answer (default: true)
    """

    question: str
    header: str
    options: list[QuestionOption]
    multiple: bool | Unset = UNSET
    custom: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.question_option import QuestionOption

        question = self.question

        header = self.header

        options = []
        for options_item_data in self.options:
            options_item = options_item_data.to_dict()
            options.append(options_item)

        multiple = self.multiple

        custom = self.custom

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        question_info.additional_properties = d
        return question_info

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
