from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.step_finish_part_tokens_cache import StepFinishPartTokensCache


T = TypeVar("T", bound="StepFinishPartTokens")


@_attrs_define
class StepFinishPartTokens:
    """
    Attributes:
        input_ (int):
        output (int):
        reasoning (int):
        cache (StepFinishPartTokensCache):
        total (int | Unset):
    """

    input_: int
    output: int
    reasoning: int
    cache: StepFinishPartTokensCache
    total: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.step_finish_part_tokens_cache import StepFinishPartTokensCache

        input_ = self.input_

        output = self.output

        reasoning = self.reasoning

        cache = self.cache.to_dict()

        total = self.total

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "input": input_,
                "output": output,
                "reasoning": reasoning,
                "cache": cache,
            }
        )
        if total is not UNSET:
            field_dict["total"] = total

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.step_finish_part_tokens_cache import StepFinishPartTokensCache

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        reasoning = d.pop("reasoning")

        cache = StepFinishPartTokensCache.from_dict(d.pop("cache"))

        total = d.pop("total", UNSET)

        step_finish_part_tokens = cls(
            input_=input_,
            output=output,
            reasoning=reasoning,
            cache=cache,
            total=total,
        )

        step_finish_part_tokens.additional_properties = d
        return step_finish_part_tokens

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
