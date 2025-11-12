from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigProviderAdditionalPropertyOptions")


@_attrs_define
class ConfigProviderAdditionalPropertyOptions:
    """
    Attributes:
        api_key (Union[Unset, str]):
        base_url (Union[Unset, str]):
        timeout (Union[Unset, bool, int]): Timeout in milliseconds for requests to this provider. Default is 300000 (5
            minutes). Set to false to disable timeout.
    """

    api_key: Union[Unset, str] = UNSET
    base_url: Union[Unset, str] = UNSET
    timeout: Union[Unset, bool, int] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        api_key = self.api_key

        base_url = self.base_url

        timeout: Union[Unset, bool, int]
        if isinstance(self.timeout, Unset):
            timeout = UNSET
        else:
            timeout = self.timeout

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if api_key is not UNSET:
            field_dict["apiKey"] = api_key
        if base_url is not UNSET:
            field_dict["baseURL"] = base_url
        if timeout is not UNSET:
            field_dict["timeout"] = timeout

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        api_key = d.pop("apiKey", UNSET)

        base_url = d.pop("baseURL", UNSET)

        def _parse_timeout(data: object) -> Union[Unset, bool, int]:
            if isinstance(data, Unset):
                return data
            return cast(Union[Unset, bool, int], data)

        timeout = _parse_timeout(d.pop("timeout", UNSET))

        config_provider_additional_property_options = cls(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )

        config_provider_additional_property_options.additional_properties = d
        return config_provider_additional_property_options

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
