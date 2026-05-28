from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.provider import Provider
    from ..models.provider_list_response_200_default import ProviderListResponse200Default


T = TypeVar("T", bound="ProviderListResponse200")


@_attrs_define
class ProviderListResponse200:
    """List of providers

    Attributes:
        all_ (list[Provider]):
        default (ProviderListResponse200Default):
        connected (list[str]):
    """

    all_: list[Provider]
    default: ProviderListResponse200Default
    connected: list[str]

    def to_dict(self) -> dict[str, Any]:
        all_ = []
        for all_item_data in self.all_:
            all_item = all_item_data.to_dict()
            all_.append(all_item)

        default = self.default.to_dict()

        connected = self.connected

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "all": all_,
                "default": default,
                "connected": connected,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider import Provider
        from ..models.provider_list_response_200_default import ProviderListResponse200Default

        d = dict(src_dict)
        all_ = []
        _all_ = d.pop("all")
        for all_item_data in _all_:
            all_item = Provider.from_dict(all_item_data)

            all_.append(all_item)

        default = ProviderListResponse200Default.from_dict(d.pop("default"))

        connected = cast(list[str], d.pop("connected"))

        provider_list_response_200 = cls(
            all_=all_,
            default=default,
            connected=connected,
        )

        return provider_list_response_200
