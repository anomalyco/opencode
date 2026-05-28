from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="QuestionOption")


@_attrs_define
class QuestionOption:
    """
    Attributes:
        label (str): Display text (1-5 words, concise)
        description (str): Explanation of choice
    """

    label: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        label = self.label

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "label": label,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        label = d.pop("label")

        description = d.pop("description")

        question_option = cls(
            label=label,
            description=description,
        )

        return question_option
