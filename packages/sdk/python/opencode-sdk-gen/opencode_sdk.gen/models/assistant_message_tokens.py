from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.assistant_message_tokens_cache import AssistantMessageTokensCache


T = TypeVar("T", bound="AssistantMessageTokens")


@_attrs_define
class AssistantMessageTokens:
    """
    Attributes:
        input_ (float):
        output (float):
        reasoning (float):
        cache (AssistantMessageTokensCache):
        total (float | Unset):
    """

    input_: float
    output: float
    reasoning: float
    cache: AssistantMessageTokensCache
    total: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        output = self.output

        reasoning = self.reasoning

        cache = self.cache.to_dict()

        total = self.total

        field_dict: dict[str, Any] = {}

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
        from ..models.assistant_message_tokens_cache import AssistantMessageTokensCache

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        reasoning = d.pop("reasoning")

        cache = AssistantMessageTokensCache.from_dict(d.pop("cache"))

        total = d.pop("total", UNSET)

        assistant_message_tokens = cls(
            input_=input_,
            output=output,
            reasoning=reasoning,
            cache=cache,
            total=total,
        )

        return assistant_message_tokens
