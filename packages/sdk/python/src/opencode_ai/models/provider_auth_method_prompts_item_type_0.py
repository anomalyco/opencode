from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_auth_method_prompts_item_type_0_when import ProviderAuthMethodPromptsItemType0When


T = TypeVar("T", bound="ProviderAuthMethodPromptsItemType0")


@_attrs_define
class ProviderAuthMethodPromptsItemType0:
    """
    Attributes:
        type_ (Literal['text']):
        key (str):
        message (str):
        placeholder (str | Unset):
        when (ProviderAuthMethodPromptsItemType0When | Unset):
    """

    type_: Literal["text"]
    key: str
    message: str
    placeholder: str | Unset = UNSET
    when: ProviderAuthMethodPromptsItemType0When | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_auth_method_prompts_item_type_0_when import ProviderAuthMethodPromptsItemType0When

        type_ = self.type_

        key = self.key

        message = self.message

        placeholder = self.placeholder

        when: dict[str, Any] | Unset = UNSET
        if not isinstance(self.when, Unset):
            when = self.when.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        type_ = cast(Literal["text"], d.pop("type"))
        if type_ != "text":
            raise ValueError(f"type must match const 'text', got '{type_}'")

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

        provider_auth_method_prompts_item_type_0.additional_properties = d
        return provider_auth_method_prompts_item_type_0

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
