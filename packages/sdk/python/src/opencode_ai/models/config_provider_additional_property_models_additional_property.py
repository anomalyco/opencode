from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_provider_additional_property_models_additional_property_cost import (
        ConfigProviderAdditionalPropertyModelsAdditionalPropertyCost,
    )
    from ..models.config_provider_additional_property_models_additional_property_limit import (
        ConfigProviderAdditionalPropertyModelsAdditionalPropertyLimit,
    )
    from ..models.config_provider_additional_property_models_additional_property_options import (
        ConfigProviderAdditionalPropertyModelsAdditionalPropertyOptions,
    )
    from ..models.config_provider_additional_property_models_additional_property_provider import (
        ConfigProviderAdditionalPropertyModelsAdditionalPropertyProvider,
    )


T = TypeVar("T", bound="ConfigProviderAdditionalPropertyModelsAdditionalProperty")


@_attrs_define
class ConfigProviderAdditionalPropertyModelsAdditionalProperty:
    """
    Attributes:
        id (Union[Unset, str]):
        name (Union[Unset, str]):
        release_date (Union[Unset, str]):
        attachment (Union[Unset, bool]):
        reasoning (Union[Unset, bool]):
        temperature (Union[Unset, bool]):
        tool_call (Union[Unset, bool]):
        cost (Union[Unset, ConfigProviderAdditionalPropertyModelsAdditionalPropertyCost]):
        limit (Union[Unset, ConfigProviderAdditionalPropertyModelsAdditionalPropertyLimit]):
        experimental (Union[Unset, bool]):
        options (Union[Unset, ConfigProviderAdditionalPropertyModelsAdditionalPropertyOptions]):
        provider (Union[Unset, ConfigProviderAdditionalPropertyModelsAdditionalPropertyProvider]):
    """

    id: Union[Unset, str] = UNSET
    name: Union[Unset, str] = UNSET
    release_date: Union[Unset, str] = UNSET
    attachment: Union[Unset, bool] = UNSET
    reasoning: Union[Unset, bool] = UNSET
    temperature: Union[Unset, bool] = UNSET
    tool_call: Union[Unset, bool] = UNSET
    cost: Union[Unset, "ConfigProviderAdditionalPropertyModelsAdditionalPropertyCost"] = UNSET
    limit: Union[Unset, "ConfigProviderAdditionalPropertyModelsAdditionalPropertyLimit"] = UNSET
    experimental: Union[Unset, bool] = UNSET
    options: Union[Unset, "ConfigProviderAdditionalPropertyModelsAdditionalPropertyOptions"] = UNSET
    provider: Union[Unset, "ConfigProviderAdditionalPropertyModelsAdditionalPropertyProvider"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        release_date = self.release_date

        attachment = self.attachment

        reasoning = self.reasoning

        temperature = self.temperature

        tool_call = self.tool_call

        cost: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.cost, Unset):
            cost = self.cost.to_dict()

        limit: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.limit, Unset):
            limit = self.limit.to_dict()

        experimental = self.experimental

        options: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.options, Unset):
            options = self.options.to_dict()

        provider: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.provider, Unset):
            provider = self.provider.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if name is not UNSET:
            field_dict["name"] = name
        if release_date is not UNSET:
            field_dict["release_date"] = release_date
        if attachment is not UNSET:
            field_dict["attachment"] = attachment
        if reasoning is not UNSET:
            field_dict["reasoning"] = reasoning
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if tool_call is not UNSET:
            field_dict["tool_call"] = tool_call
        if cost is not UNSET:
            field_dict["cost"] = cost
        if limit is not UNSET:
            field_dict["limit"] = limit
        if experimental is not UNSET:
            field_dict["experimental"] = experimental
        if options is not UNSET:
            field_dict["options"] = options
        if provider is not UNSET:
            field_dict["provider"] = provider

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_provider_additional_property_models_additional_property_cost import (
            ConfigProviderAdditionalPropertyModelsAdditionalPropertyCost,
        )
        from ..models.config_provider_additional_property_models_additional_property_limit import (
            ConfigProviderAdditionalPropertyModelsAdditionalPropertyLimit,
        )
        from ..models.config_provider_additional_property_models_additional_property_options import (
            ConfigProviderAdditionalPropertyModelsAdditionalPropertyOptions,
        )
        from ..models.config_provider_additional_property_models_additional_property_provider import (
            ConfigProviderAdditionalPropertyModelsAdditionalPropertyProvider,
        )

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        name = d.pop("name", UNSET)

        release_date = d.pop("release_date", UNSET)

        attachment = d.pop("attachment", UNSET)

        reasoning = d.pop("reasoning", UNSET)

        temperature = d.pop("temperature", UNSET)

        tool_call = d.pop("tool_call", UNSET)

        _cost = d.pop("cost", UNSET)
        cost: Union[Unset, ConfigProviderAdditionalPropertyModelsAdditionalPropertyCost]
        if isinstance(_cost, Unset):
            cost = UNSET
        else:
            cost = ConfigProviderAdditionalPropertyModelsAdditionalPropertyCost.from_dict(_cost)

        _limit = d.pop("limit", UNSET)
        limit: Union[Unset, ConfigProviderAdditionalPropertyModelsAdditionalPropertyLimit]
        if isinstance(_limit, Unset):
            limit = UNSET
        else:
            limit = ConfigProviderAdditionalPropertyModelsAdditionalPropertyLimit.from_dict(_limit)

        experimental = d.pop("experimental", UNSET)

        _options = d.pop("options", UNSET)
        options: Union[Unset, ConfigProviderAdditionalPropertyModelsAdditionalPropertyOptions]
        if isinstance(_options, Unset):
            options = UNSET
        else:
            options = ConfigProviderAdditionalPropertyModelsAdditionalPropertyOptions.from_dict(_options)

        _provider = d.pop("provider", UNSET)
        provider: Union[Unset, ConfigProviderAdditionalPropertyModelsAdditionalPropertyProvider]
        if isinstance(_provider, Unset):
            provider = UNSET
        else:
            provider = ConfigProviderAdditionalPropertyModelsAdditionalPropertyProvider.from_dict(_provider)

        config_provider_additional_property_models_additional_property = cls(
            id=id,
            name=name,
            release_date=release_date,
            attachment=attachment,
            reasoning=reasoning,
            temperature=temperature,
            tool_call=tool_call,
            cost=cost,
            limit=limit,
            experimental=experimental,
            options=options,
            provider=provider,
        )

        config_provider_additional_property_models_additional_property.additional_properties = d
        return config_provider_additional_property_models_additional_property

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
