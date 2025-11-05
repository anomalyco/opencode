from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.config_providers_response_200_default import ConfigProvidersResponse200Default
    from ..models.provider import Provider


T = TypeVar("T", bound="ConfigProvidersResponse200")


@_attrs_define
class ConfigProvidersResponse200:
    """
    Attributes:
        providers (list['Provider']):
        default (ConfigProvidersResponse200Default):
    """

    providers: list["Provider"]
    default: "ConfigProvidersResponse200Default"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        providers = []
        for providers_item_data in self.providers:
            providers_item = providers_item_data.to_dict()
            providers.append(providers_item)

        default = self.default.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        config_providers_response_200.additional_properties = d
        return config_providers_response_200

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
