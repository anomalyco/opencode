from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.provider_config_models_additional_property_status import ProviderConfigModelsAdditionalPropertyStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_config_models_additional_property_cost import ProviderConfigModelsAdditionalPropertyCost
    from ..models.provider_config_models_additional_property_headers import (
        ProviderConfigModelsAdditionalPropertyHeaders,
    )
    from ..models.provider_config_models_additional_property_interleaved_type_1 import (
        ProviderConfigModelsAdditionalPropertyInterleavedType1,
    )
    from ..models.provider_config_models_additional_property_limit import ProviderConfigModelsAdditionalPropertyLimit
    from ..models.provider_config_models_additional_property_modalities import (
        ProviderConfigModelsAdditionalPropertyModalities,
    )
    from ..models.provider_config_models_additional_property_options import (
        ProviderConfigModelsAdditionalPropertyOptions,
    )
    from ..models.provider_config_models_additional_property_provider import (
        ProviderConfigModelsAdditionalPropertyProvider,
    )
    from ..models.provider_config_models_additional_property_variants import (
        ProviderConfigModelsAdditionalPropertyVariants,
    )


T = TypeVar("T", bound="ProviderConfigModelsAdditionalProperty")


@_attrs_define
class ProviderConfigModelsAdditionalProperty:
    """
    Attributes:
        id (str | Unset):
        name (str | Unset):
        family (str | Unset):
        release_date (str | Unset):
        attachment (bool | Unset):
        reasoning (bool | Unset):
        temperature (bool | Unset):
        tool_call (bool | Unset):
        interleaved (bool | ProviderConfigModelsAdditionalPropertyInterleavedType1 | Unset):
        cost (ProviderConfigModelsAdditionalPropertyCost | Unset):
        limit (ProviderConfigModelsAdditionalPropertyLimit | Unset):
        modalities (ProviderConfigModelsAdditionalPropertyModalities | Unset):
        experimental (bool | Unset):
        status (ProviderConfigModelsAdditionalPropertyStatus | Unset):
        provider (ProviderConfigModelsAdditionalPropertyProvider | Unset):
        options (ProviderConfigModelsAdditionalPropertyOptions | Unset):
        headers (ProviderConfigModelsAdditionalPropertyHeaders | Unset):
        variants (ProviderConfigModelsAdditionalPropertyVariants | Unset): Variant-specific configuration
    """

    id: str | Unset = UNSET
    name: str | Unset = UNSET
    family: str | Unset = UNSET
    release_date: str | Unset = UNSET
    attachment: bool | Unset = UNSET
    reasoning: bool | Unset = UNSET
    temperature: bool | Unset = UNSET
    tool_call: bool | Unset = UNSET
    interleaved: bool | ProviderConfigModelsAdditionalPropertyInterleavedType1 | Unset = UNSET
    cost: ProviderConfigModelsAdditionalPropertyCost | Unset = UNSET
    limit: ProviderConfigModelsAdditionalPropertyLimit | Unset = UNSET
    modalities: ProviderConfigModelsAdditionalPropertyModalities | Unset = UNSET
    experimental: bool | Unset = UNSET
    status: ProviderConfigModelsAdditionalPropertyStatus | Unset = UNSET
    provider: ProviderConfigModelsAdditionalPropertyProvider | Unset = UNSET
    options: ProviderConfigModelsAdditionalPropertyOptions | Unset = UNSET
    headers: ProviderConfigModelsAdditionalPropertyHeaders | Unset = UNSET
    variants: ProviderConfigModelsAdditionalPropertyVariants | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_config_models_additional_property_interleaved_type_1 import (
            ProviderConfigModelsAdditionalPropertyInterleavedType1,
        )

        id = self.id

        name = self.name

        family = self.family

        release_date = self.release_date

        attachment = self.attachment

        reasoning = self.reasoning

        temperature = self.temperature

        tool_call = self.tool_call

        interleaved: bool | dict[str, Any] | Unset
        if isinstance(self.interleaved, Unset):
            interleaved = UNSET
        elif isinstance(self.interleaved, ProviderConfigModelsAdditionalPropertyInterleavedType1):
            interleaved = self.interleaved.to_dict()
        else:
            interleaved = self.interleaved

        cost: dict[str, Any] | Unset = UNSET
        if not isinstance(self.cost, Unset):
            cost = self.cost.to_dict()

        limit: dict[str, Any] | Unset = UNSET
        if not isinstance(self.limit, Unset):
            limit = self.limit.to_dict()

        modalities: dict[str, Any] | Unset = UNSET
        if not isinstance(self.modalities, Unset):
            modalities = self.modalities.to_dict()

        experimental = self.experimental

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        provider: dict[str, Any] | Unset = UNSET
        if not isinstance(self.provider, Unset):
            provider = self.provider.to_dict()

        options: dict[str, Any] | Unset = UNSET
        if not isinstance(self.options, Unset):
            options = self.options.to_dict()

        headers: dict[str, Any] | Unset = UNSET
        if not isinstance(self.headers, Unset):
            headers = self.headers.to_dict()

        variants: dict[str, Any] | Unset = UNSET
        if not isinstance(self.variants, Unset):
            variants = self.variants.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if name is not UNSET:
            field_dict["name"] = name
        if family is not UNSET:
            field_dict["family"] = family
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
        if interleaved is not UNSET:
            field_dict["interleaved"] = interleaved
        if cost is not UNSET:
            field_dict["cost"] = cost
        if limit is not UNSET:
            field_dict["limit"] = limit
        if modalities is not UNSET:
            field_dict["modalities"] = modalities
        if experimental is not UNSET:
            field_dict["experimental"] = experimental
        if status is not UNSET:
            field_dict["status"] = status
        if provider is not UNSET:
            field_dict["provider"] = provider
        if options is not UNSET:
            field_dict["options"] = options
        if headers is not UNSET:
            field_dict["headers"] = headers
        if variants is not UNSET:
            field_dict["variants"] = variants

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_config_models_additional_property_cost import ProviderConfigModelsAdditionalPropertyCost
        from ..models.provider_config_models_additional_property_headers import (
            ProviderConfigModelsAdditionalPropertyHeaders,
        )
        from ..models.provider_config_models_additional_property_interleaved_type_1 import (
            ProviderConfigModelsAdditionalPropertyInterleavedType1,
        )
        from ..models.provider_config_models_additional_property_limit import (
            ProviderConfigModelsAdditionalPropertyLimit,
        )
        from ..models.provider_config_models_additional_property_modalities import (
            ProviderConfigModelsAdditionalPropertyModalities,
        )
        from ..models.provider_config_models_additional_property_options import (
            ProviderConfigModelsAdditionalPropertyOptions,
        )
        from ..models.provider_config_models_additional_property_provider import (
            ProviderConfigModelsAdditionalPropertyProvider,
        )
        from ..models.provider_config_models_additional_property_variants import (
            ProviderConfigModelsAdditionalPropertyVariants,
        )

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        name = d.pop("name", UNSET)

        family = d.pop("family", UNSET)

        release_date = d.pop("release_date", UNSET)

        attachment = d.pop("attachment", UNSET)

        reasoning = d.pop("reasoning", UNSET)

        temperature = d.pop("temperature", UNSET)

        tool_call = d.pop("tool_call", UNSET)

        def _parse_interleaved(data: object) -> bool | ProviderConfigModelsAdditionalPropertyInterleavedType1 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                interleaved_type_1 = ProviderConfigModelsAdditionalPropertyInterleavedType1.from_dict(data)

                return interleaved_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(bool | ProviderConfigModelsAdditionalPropertyInterleavedType1 | Unset, data)

        interleaved = _parse_interleaved(d.pop("interleaved", UNSET))

        _cost = d.pop("cost", UNSET)
        cost: ProviderConfigModelsAdditionalPropertyCost | Unset
        if isinstance(_cost, Unset):
            cost = UNSET
        else:
            cost = ProviderConfigModelsAdditionalPropertyCost.from_dict(_cost)

        _limit = d.pop("limit", UNSET)
        limit: ProviderConfigModelsAdditionalPropertyLimit | Unset
        if isinstance(_limit, Unset):
            limit = UNSET
        else:
            limit = ProviderConfigModelsAdditionalPropertyLimit.from_dict(_limit)

        _modalities = d.pop("modalities", UNSET)
        modalities: ProviderConfigModelsAdditionalPropertyModalities | Unset
        if isinstance(_modalities, Unset):
            modalities = UNSET
        else:
            modalities = ProviderConfigModelsAdditionalPropertyModalities.from_dict(_modalities)

        experimental = d.pop("experimental", UNSET)

        _status = d.pop("status", UNSET)
        status: ProviderConfigModelsAdditionalPropertyStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = ProviderConfigModelsAdditionalPropertyStatus(_status)

        _provider = d.pop("provider", UNSET)
        provider: ProviderConfigModelsAdditionalPropertyProvider | Unset
        if isinstance(_provider, Unset):
            provider = UNSET
        else:
            provider = ProviderConfigModelsAdditionalPropertyProvider.from_dict(_provider)

        _options = d.pop("options", UNSET)
        options: ProviderConfigModelsAdditionalPropertyOptions | Unset
        if isinstance(_options, Unset):
            options = UNSET
        else:
            options = ProviderConfigModelsAdditionalPropertyOptions.from_dict(_options)

        _headers = d.pop("headers", UNSET)
        headers: ProviderConfigModelsAdditionalPropertyHeaders | Unset
        if isinstance(_headers, Unset):
            headers = UNSET
        else:
            headers = ProviderConfigModelsAdditionalPropertyHeaders.from_dict(_headers)

        _variants = d.pop("variants", UNSET)
        variants: ProviderConfigModelsAdditionalPropertyVariants | Unset
        if isinstance(_variants, Unset):
            variants = UNSET
        else:
            variants = ProviderConfigModelsAdditionalPropertyVariants.from_dict(_variants)

        provider_config_models_additional_property = cls(
            id=id,
            name=name,
            family=family,
            release_date=release_date,
            attachment=attachment,
            reasoning=reasoning,
            temperature=temperature,
            tool_call=tool_call,
            interleaved=interleaved,
            cost=cost,
            limit=limit,
            modalities=modalities,
            experimental=experimental,
            status=status,
            provider=provider,
            options=options,
            headers=headers,
            variants=variants,
        )

        return provider_config_models_additional_property
