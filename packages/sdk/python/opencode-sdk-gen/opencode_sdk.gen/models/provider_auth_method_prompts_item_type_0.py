from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_auth_method_prompts_item_type_0_type import ProviderAuthMethodPromptsItemType0Type
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_auth_method_prompts_item_type_0_when import ProviderAuthMethodPromptsItemType0When


T = TypeVar("T", bound="ProviderAuthMethodPromptsItemType0")


@_attrs_define
class ProviderAuthMethodPromptsItemType0:
    """
    Attributes:
        type_ (ProviderAuthMethodPromptsItemType0Type):
        key (str):
        message (str):
        placeholder (str | Unset):
        when (ProviderAuthMethodPromptsItemType0When | Unset):
    """

    type_: ProviderAuthMethodPromptsItemType0Type
    key: str
    message: str
    placeholder: str | Unset = UNSET
    when: ProviderAuthMethodPromptsItemType0When | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        key = self.key

        message = self.message

        placeholder = self.placeholder

        when: dict[str, Any] | Unset = UNSET
        if not isinstance(self.when, Unset):
            when = self.when.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "key": key,
                "message": message,
            }
        )
        if placeholder is not UNSET:
            field_dict["placeholder"] = placeholder
        if when is not UNSET:
            field_dict["when"] = when

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_auth_method_prompts_item_type_0_when import ProviderAuthMethodPromptsItemType0When

        d = dict(src_dict)
        type_ = ProviderAuthMethodPromptsItemType0Type(d.pop("type"))

        key = d.pop("key")

        message = d.pop("message")

        placeholder = d.pop("placeholder", UNSET)

        _when = d.pop("when", UNSET)
        when: ProviderAuthMethodPromptsItemType0When | Unset
        if isinstance(_when, Unset):
            when = UNSET
        else:
            when = ProviderAuthMethodPromptsItemType0When.from_dict(_when)

        provider_auth_method_prompts_item_type_0 = cls(
            type_=type_,
            key=key,
            message=message,
            placeholder=placeholder,
            when=when,
        )

        return provider_auth_method_prompts_item_type_0
