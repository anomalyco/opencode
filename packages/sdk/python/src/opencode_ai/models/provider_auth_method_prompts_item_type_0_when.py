from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.provider_auth_method_prompts_item_type_0_when_op import ProviderAuthMethodPromptsItemType0WhenOp
from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        op = self.op.value

        value = self.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        provider_auth_method_prompts_item_type_0_when.additional_properties = d
        return provider_auth_method_prompts_item_type_0_when

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
