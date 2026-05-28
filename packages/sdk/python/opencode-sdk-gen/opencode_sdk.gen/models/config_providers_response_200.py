from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.config_providers_response_200_default import ConfigProvidersResponse200Default
    from ..models.provider import Provider


T = TypeVar("T", bound="ConfigProvidersResponse200")


@_attrs_define
class ConfigProvidersResponse200:
    """List of providers

    Attributes:
        providers (list[Provider]):
        default (ConfigProvidersResponse200Default):
    """

    providers: list[Provider]
    default: ConfigProvidersResponse200Default

    def to_dict(self) -> dict[str, Any]:
        providers = []
        for providers_item_data in self.providers:
            providers_item = providers_item_data.to_dict()
            providers.append(providers_item)

        default = self.default.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "providers": providers,
                "default": default,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_providers_response_200_default import ConfigProvidersResponse200Default
        from ..models.provider import Provider

        d = dict(src_dict)
        providers = []
        _providers = d.pop("providers")
        for providers_item_data in _providers:
            providers_item = Provider.from_dict(providers_item_data)

            providers.append(providers_item)

        default = ConfigProvidersResponse200Default.from_dict(d.pop("default"))

        config_providers_response_200 = cls(
            providers=providers,
            default=default,
        )

        return config_providers_response_200
