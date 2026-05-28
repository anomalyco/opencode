from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ModelV2Info1Limit")


@_attrs_define
class ModelV2Info1Limit:
    """
    Attributes:
        context (int):
        output (int):
        input_ (int | Unset):
    """

    context: int
    output: int
    input_: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        context = self.context

        output = self.output

        input_ = self.input_

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "context": context,
                "output": output,
            }
        )
        if input_ is not UNSET:
            field_dict["input"] = input_

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        context = d.pop("context")

        output = d.pop("output")

        input_ = d.pop("input", UNSET)

        model_v2_info_1_limit = cls(
            context=context,
            output=output,
            input_=input_,
        )

        return model_v2_info_1_limit
