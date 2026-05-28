from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ConfigLspType1AdditionalPropertyType0")


@_attrs_define
class ConfigLspType1AdditionalPropertyType0:
    """
    Attributes:
        disabled (bool):
    """

    disabled: bool

    def to_dict(self) -> dict[str, Any]:
        disabled = self.disabled

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "disabled": disabled,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        disabled = d.pop("disabled")

        config_lsp_type_1_additional_property_type_0 = cls(
            disabled=disabled,
        )

        return config_lsp_type_1_additional_property_type_0
