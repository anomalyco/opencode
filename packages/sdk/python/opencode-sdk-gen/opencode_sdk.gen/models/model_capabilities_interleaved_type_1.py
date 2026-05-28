from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.model_capabilities_interleaved_type_1_field import ModelCapabilitiesInterleavedType1Field

T = TypeVar("T", bound="ModelCapabilitiesInterleavedType1")


@_attrs_define
class ModelCapabilitiesInterleavedType1:
    """
    Attributes:
        field (ModelCapabilitiesInterleavedType1Field):
    """

    field: ModelCapabilitiesInterleavedType1Field

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
        field = ModelCapabilitiesInterleavedType1Field(d.pop("field"))

        model_capabilities_interleaved_type_1 = cls(
            field=field,
        )

        return model_capabilities_interleaved_type_1
