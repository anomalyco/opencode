from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.event_session_next_step_ended_properties_tokens_cache import (
        EventSessionNextStepEndedPropertiesTokensCache,
    )


T = TypeVar("T", bound="EventSessionNextStepEndedPropertiesTokens")


@_attrs_define
class EventSessionNextStepEndedPropertiesTokens:
    """
    Attributes:
        input_ (float):
        output (float):
        reasoning (float):
        cache (EventSessionNextStepEndedPropertiesTokensCache):
    """

    input_: float
    output: float
    reasoning: float
    cache: EventSessionNextStepEndedPropertiesTokensCache

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
        from ..models.event_session_next_step_ended_properties_tokens_cache import (
            EventSessionNextStepEndedPropertiesTokensCache,
        )

        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        reasoning = d.pop("reasoning")

        cache = EventSessionNextStepEndedPropertiesTokensCache.from_dict(d.pop("cache"))

        event_session_next_step_ended_properties_tokens = cls(
            input_=input_,
            output=output,
            reasoning=reasoning,
            cache=cache,
        )

        return event_session_next_step_ended_properties_tokens
