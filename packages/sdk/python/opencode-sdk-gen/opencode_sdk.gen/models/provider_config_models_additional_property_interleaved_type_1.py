from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_config_models_additional_property_interleaved_type_1_field import (
    ProviderConfigModelsAdditionalPropertyInterleavedType1Field,
)

T = TypeVar("T", bound="ProviderConfigModelsAdditionalPropertyInterleavedType1")


@_attrs_define
class ProviderConfigModelsAdditionalPropertyInterleavedType1:
    """
    Attributes:
        field (ProviderConfigModelsAdditionalPropertyInterleavedType1Field):
    """

    field: ProviderConfigModelsAdditionalPropertyInterleavedType1Field

    def to_dict(self) -> dict[str, Any]:
        field = self.field.value

        field_dict: dict[str, Any] = {}

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

        return provider_config_models_additional_property_interleaved_type_1
