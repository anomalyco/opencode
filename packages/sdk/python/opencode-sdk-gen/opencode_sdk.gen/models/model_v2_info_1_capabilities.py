from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ModelV2Info1Capabilities")


@_attrs_define
class ModelV2Info1Capabilities:
    """
    Attributes:
        tools (bool):
        input_ (list[str]):
        output (list[str]):
    """

    tools: bool
    input_: list[str]
    output: list[str]

    def to_dict(self) -> dict[str, Any]:
        tools = self.tools

        input_ = self.input_

        output = self.output

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "tools": tools,
                "input": input_,
                "output": output,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        tools = d.pop("tools")

        input_ = cast(list[str], d.pop("input"))

        output = cast(list[str], d.pop("output"))

        model_v2_info_1_capabilities = cls(
            tools=tools,
            input_=input_,
            output=output,
        )

        return model_v2_info_1_capabilities
