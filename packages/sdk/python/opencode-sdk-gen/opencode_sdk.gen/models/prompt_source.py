from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PromptSource")


@_attrs_define
class PromptSource:
    """
    Attributes:
        start (float):
        end (float):
        text (str):
    """

    start: float
    end: float
    text: str

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        end = self.end

        text = self.text

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "start": start,
                "end": end,
                "text": text,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start")

        end = d.pop("end")

        text = d.pop("text")

        prompt_source = cls(
            start=start,
            end=end,
            text=text,
        )

        return prompt_source
