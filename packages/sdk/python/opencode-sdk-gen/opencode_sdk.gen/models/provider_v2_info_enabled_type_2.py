from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_v2_info_enabled_type_2_via import ProviderV2InfoEnabledType2Via

T = TypeVar("T", bound="ProviderV2InfoEnabledType2")


@_attrs_define
class ProviderV2InfoEnabledType2:
    """
    Attributes:
        via (ProviderV2InfoEnabledType2Via):
        service (str):
    """

    via: ProviderV2InfoEnabledType2Via
    service: str

    def to_dict(self) -> dict[str, Any]:
        via = self.via.value

        service = self.service

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "via": via,
                "service": service,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        via = ProviderV2InfoEnabledType2Via(d.pop("via"))

        service = d.pop("service")

        provider_v2_info_enabled_type_2 = cls(
            via=via,
            service=service,
        )

        return provider_v2_info_enabled_type_2
