from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_v2_info_enabled_type_1_via import ProviderV2InfoEnabledType1Via

T = TypeVar("T", bound="ProviderV2InfoEnabledType1")


@_attrs_define
class ProviderV2InfoEnabledType1:
    """
    Attributes:
        via (ProviderV2InfoEnabledType1Via):
        name (str):
    """

    via: ProviderV2InfoEnabledType1Via
    name: str

    def to_dict(self) -> dict[str, Any]:
        via = self.via.value

        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "via": via,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        via = ProviderV2InfoEnabledType1Via(d.pop("via"))

        name = d.pop("name")

        provider_v2_info_enabled_type_1 = cls(
            via=via,
            name=name,
        )

        return provider_v2_info_enabled_type_1
