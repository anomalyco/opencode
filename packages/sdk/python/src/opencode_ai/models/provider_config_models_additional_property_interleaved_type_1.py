from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.provider_config_models_additional_property_interleaved_type_1_field import (
    ProviderConfigModelsAdditionalPropertyInterleavedType1Field,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderConfigModelsAdditionalPropertyInterleavedType1")


@_attrs_define
class ProviderConfigModelsAdditionalPropertyInterleavedType1:
    """
    Attributes:
        field (ProviderConfigModelsAdditionalPropertyInterleavedType1Field):
    """

    field: ProviderConfigModelsAdditionalPropertyInterleavedType1Field
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "field": field,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field = ProviderConfigModelsAdditionalPropertyInterleavedType1Field(d.pop("field"))

        provider_config_models_additional_property_interleaved_type_1 = cls(
            field=field,
        )

        provider_config_models_additional_property_interleaved_type_1.additional_properties = d
        return provider_config_models_additional_property_interleaved_type_1

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
