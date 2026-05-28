from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.global_session_tokens_cache import GlobalSessionTokensCache


T = TypeVar("T", bound="GlobalSessionTokens")


@_attrs_define
class GlobalSessionTokens:
    """
    Attributes:
        input_ (float):
        output (float):
        reasoning (float):
        cache (GlobalSessionTokensCache):
    """

    input_: float
    output: float
    reasoning: float
    cache: GlobalSessionTokensCache

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        output = self.output

        reasoning = self.reasoning

        cache = self.cache.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "input": input_,
                "output": output,
                "reasoning": reasoning,
                "cache": cache,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.global_session_tokens_cache import GlobalSessionTokensCache

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        reasoning = d.pop("reasoning")

        cache = GlobalSessionTokensCache.from_dict(d.pop("cache"))

        global_session_tokens = cls(
            input_=input_,
            output=output,
            reasoning=reasoning,
            cache=cache,
        )

        return global_session_tokens
