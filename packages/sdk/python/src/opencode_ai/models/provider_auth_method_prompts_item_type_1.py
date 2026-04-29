from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_auth_method_prompts_item_type_1_options_item import (
        ProviderAuthMethodPromptsItemType1OptionsItem,
    )
    from ..models.provider_auth_method_prompts_item_type_1_when import ProviderAuthMethodPromptsItemType1When


T = TypeVar("T", bound="ProviderAuthMethodPromptsItemType1")


@_attrs_define
class ProviderAuthMethodPromptsItemType1:
    """
    Attributes:
        type_ (Literal['select']):
        key (str):
        message (str):
        options (list[ProviderAuthMethodPromptsItemType1OptionsItem]):
        when (ProviderAuthMethodPromptsItemType1When | Unset):
    """

    type_: Literal["select"]
    key: str
    message: str
    options: list[ProviderAuthMethodPromptsItemType1OptionsItem]
    when: ProviderAuthMethodPromptsItemType1When | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_auth_method_prompts_item_type_1_options_item import (
            ProviderAuthMethodPromptsItemType1OptionsItem,
        )
        from ..models.provider_auth_method_prompts_item_type_1_when import ProviderAuthMethodPromptsItemType1When

        type_ = self.type_

        key = self.key

        message = self.message

        options = []
        for options_item_data in self.options:
            options_item = options_item_data.to_dict()
            options.append(options_item)

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
                "options": options,
            }
        )
        if when is not UNSET:
            field_dict["when"] = when

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_auth_method_prompts_item_type_1_options_item import (
            ProviderAuthMethodPromptsItemType1OptionsItem,
        )
        from ..models.provider_auth_method_prompts_item_type_1_when import ProviderAuthMethodPromptsItemType1When

        d = dict(src_dict)
        type_ = cast(Literal["select"], d.pop("type"))
        if type_ != "select":
            raise ValueError(f"type must match const 'select', got '{type_}'")

        key = d.pop("key")

        message = d.pop("message")

        options = []
        _options = d.pop("options")
        for options_item_data in _options:
            options_item = ProviderAuthMethodPromptsItemType1OptionsItem.from_dict(options_item_data)

            options.append(options_item)

        _when = d.pop("when", UNSET)
        when: ProviderAuthMethodPromptsItemType1When | Unset
        if isinstance(_when, Unset):
            when = UNSET
        else:
            when = ProviderAuthMethodPromptsItemType1When.from_dict(_when)

        provider_auth_method_prompts_item_type_1 = cls(
            type_=type_,
            key=key,
            message=message,
            options=options,
            when=when,
        )

        provider_auth_method_prompts_item_type_1.additional_properties = d
        return provider_auth_method_prompts_item_type_1

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
