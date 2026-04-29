from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider import Provider
    from ..models.provider_list_response_200_default import ProviderListResponse200Default


T = TypeVar("T", bound="ProviderListResponse200")


@_attrs_define
class ProviderListResponse200:
    """
    Attributes:
        all_ (list[Provider]):
        default (ProviderListResponse200Default):
        connected (list[str]):
    """

    all_: list[Provider]
    default: ProviderListResponse200Default
    connected: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.provider import Provider
        from ..models.provider_list_response_200_default import ProviderListResponse200Default

        all_ = []
        for all_item_data in self.all_:
            all_item = all_item_data.to_dict()
            all_.append(all_item)

        default = self.default.to_dict()

        connected = self.connected

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        provider_list_response_200.additional_properties = d
        return provider_list_response_200

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
