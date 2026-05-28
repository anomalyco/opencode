from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderAuthMethodPromptsItemType1OptionsItem")


@_attrs_define
class ProviderAuthMethodPromptsItemType1OptionsItem:
    """
    Attributes:
        label (str):
        value (str):
        hint (str | Unset):
    """

    label: str
    value: str
    hint: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        label = self.label

        value = self.value

        hint = self.hint

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "label": label,
                "value": value,
            }
        )
        if hint is not UNSET:
            field_dict["hint"] = hint

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        label = d.pop("label")

        value = d.pop("value")

        hint = d.pop("hint", UNSET)

        provider_auth_method_prompts_item_type_1_options_item = cls(
            label=label,
            value=value,
            hint=hint,
        )

        return provider_auth_method_prompts_item_type_1_options_item
