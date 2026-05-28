from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_delivery import SessionDelivery
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.prompt import Prompt


T = TypeVar("T", bound="V2SessionPromptBody")


@_attrs_define
class V2SessionPromptBody:
    """
    Attributes:
        prompt (Prompt):
        delivery (SessionDelivery | Unset):
    """

    prompt: Prompt
    delivery: SessionDelivery | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        prompt = self.prompt.to_dict()

        delivery: str | Unset = UNSET
        if not isinstance(self.delivery, Unset):
            delivery = self.delivery.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "prompt": prompt,
            }
        )
        if delivery is not UNSET:
            field_dict["delivery"] = delivery

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.prompt import Prompt

        d = dict(src_dict)
        prompt = Prompt.from_dict(d.pop("prompt"))

        _delivery = d.pop("delivery", UNSET)
        delivery: SessionDelivery | Unset
        if isinstance(_delivery, Unset):
            delivery = UNSET
        else:
            delivery = SessionDelivery(_delivery)

        v2_session_prompt_body = cls(
            prompt=prompt,
            delivery=delivery,
        )

        return v2_session_prompt_body
