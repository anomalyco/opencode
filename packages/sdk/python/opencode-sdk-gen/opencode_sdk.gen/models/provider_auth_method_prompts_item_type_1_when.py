from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_auth_method_prompts_item_type_1_when_op import ProviderAuthMethodPromptsItemType1WhenOp

T = TypeVar("T", bound="ProviderAuthMethodPromptsItemType1When")


@_attrs_define
class ProviderAuthMethodPromptsItemType1When:
    """
    Attributes:
        key (str):
        op (ProviderAuthMethodPromptsItemType1WhenOp):
        value (str):
    """

    key: str
    op: ProviderAuthMethodPromptsItemType1WhenOp
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

        op = ProviderAuthMethodPromptsItemType1WhenOp(d.pop("op"))

        value = d.pop("value")

        provider_auth_method_prompts_item_type_1_when = cls(
            key=key,
            op=op,
            value=value,
        )

        return provider_auth_method_prompts_item_type_1_when
