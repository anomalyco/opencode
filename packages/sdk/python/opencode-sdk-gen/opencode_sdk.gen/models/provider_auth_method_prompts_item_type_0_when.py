from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_auth_method_prompts_item_type_0_when_op import ProviderAuthMethodPromptsItemType0WhenOp

T = TypeVar("T", bound="ProviderAuthMethodPromptsItemType0When")


@_attrs_define
class ProviderAuthMethodPromptsItemType0When:
    """
    Attributes:
        key (str):
        op (ProviderAuthMethodPromptsItemType0WhenOp):
        value (str):
    """

    key: str
    op: ProviderAuthMethodPromptsItemType0WhenOp
    value: str

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        op = self.op.value

        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "key": key,
                "op": op,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        key = d.pop("key")

        op = ProviderAuthMethodPromptsItemType0WhenOp(d.pop("op"))

        value = d.pop("value")

        provider_auth_method_prompts_item_type_0_when = cls(
            key=key,
            op=op,
            value=value,
        )

        return provider_auth_method_prompts_item_type_0_when
