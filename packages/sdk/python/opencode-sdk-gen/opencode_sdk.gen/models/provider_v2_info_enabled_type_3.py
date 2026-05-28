from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_v2_info_enabled_type_3_via import ProviderV2InfoEnabledType3Via

if TYPE_CHECKING:
    from ..models.provider_v2_info_enabled_type_3_data import ProviderV2InfoEnabledType3Data


T = TypeVar("T", bound="ProviderV2InfoEnabledType3")


@_attrs_define
class ProviderV2InfoEnabledType3:
    """
    Attributes:
        via (ProviderV2InfoEnabledType3Via):
        data (ProviderV2InfoEnabledType3Data):
    """

    via: ProviderV2InfoEnabledType3Via
    data: ProviderV2InfoEnabledType3Data

    def to_dict(self) -> dict[str, Any]:
        via = self.via.value

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "via": via,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_v2_info_enabled_type_3_data import ProviderV2InfoEnabledType3Data

        d = dict(src_dict)
        via = ProviderV2InfoEnabledType3Via(d.pop("via"))

        data = ProviderV2InfoEnabledType3Data.from_dict(d.pop("data"))

        provider_v2_info_enabled_type_3 = cls(
            via=via,
            data=data,
        )

        return provider_v2_info_enabled_type_3
