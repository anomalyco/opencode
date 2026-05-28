from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.model_v2_info_status import ModelV2InfoStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_v2_info_capabilities import ModelV2InfoCapabilities
    from ..models.model_v2_info_cost_item import ModelV2InfoCostItem
    from ..models.model_v2_info_endpoint_type_0 import ModelV2InfoEndpointType0
    from ..models.model_v2_info_endpoint_type_1 import ModelV2InfoEndpointType1
    from ..models.model_v2_info_endpoint_type_2 import ModelV2InfoEndpointType2
    from ..models.model_v2_info_endpoint_type_3 import ModelV2InfoEndpointType3
    from ..models.model_v2_info_endpoint_type_4 import ModelV2InfoEndpointType4
    from ..models.model_v2_info_limit import ModelV2InfoLimit
    from ..models.model_v2_info_options import ModelV2InfoOptions
    from ..models.model_v2_info_time import ModelV2InfoTime
    from ..models.model_v2_info_variants_item import ModelV2InfoVariantsItem


T = TypeVar("T", bound="ModelV2Info")


@_attrs_define
class ModelV2Info:
    """
    Attributes:
        id (str):
        api_id (str):
        provider_id (str):
        name (str):
        endpoint (ModelV2InfoEndpointType0 | ModelV2InfoEndpointType1 | ModelV2InfoEndpointType2 |
            ModelV2InfoEndpointType3 | ModelV2InfoEndpointType4):
        capabilities (ModelV2InfoCapabilities):
        options (ModelV2InfoOptions):
        variants (list[ModelV2InfoVariantsItem]):
        time (ModelV2InfoTime):
        cost (list[ModelV2InfoCostItem]):
        status (ModelV2InfoStatus):
        enabled (bool):
        limit (ModelV2InfoLimit):
        family (str | Unset):
    """

    id: str
    api_id: str
    provider_id: str
    name: str
    endpoint: (
        ModelV2InfoEndpointType0
        | ModelV2InfoEndpointType1
        | ModelV2InfoEndpointType2
        | ModelV2InfoEndpointType3
        | ModelV2InfoEndpointType4
    )
    capabilities: ModelV2InfoCapabilities
    options: ModelV2InfoOptions
    variants: list[ModelV2InfoVariantsItem]
    time: ModelV2InfoTime
    cost: list[ModelV2InfoCostItem]
    status: ModelV2InfoStatus
    enabled: bool
    limit: ModelV2InfoLimit
    family: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.model_v2_info_endpoint_type_0 import ModelV2InfoEndpointType0
        from ..models.model_v2_info_endpoint_type_1 import ModelV2InfoEndpointType1
        from ..models.model_v2_info_endpoint_type_2 import ModelV2InfoEndpointType2
        from ..models.model_v2_info_endpoint_type_3 import ModelV2InfoEndpointType3

        id = self.id

        api_id = self.api_id

        provider_id = self.provider_id

        name = self.name

        endpoint: dict[str, Any]
        if isinstance(self.endpoint, ModelV2InfoEndpointType0):
            endpoint = self.endpoint.to_dict()
        elif isinstance(self.endpoint, ModelV2InfoEndpointType1):
            endpoint = self.endpoint.to_dict()
        elif isinstance(self.endpoint, ModelV2InfoEndpointType2):
            endpoint = self.endpoint.to_dict()
        elif isinstance(self.endpoint, ModelV2InfoEndpointType3):
            endpoint = self.endpoint.to_dict()
        else:
            endpoint = self.endpoint.to_dict()

        capabilities = self.capabilities.to_dict()

        options = self.options.to_dict()

        variants = []
        for variants_item_data in self.variants:
            variants_item = variants_item_data.to_dict()
            variants.append(variants_item)

        time = self.time.to_dict()

        cost = []
        for cost_item_data in self.cost:
            cost_item = cost_item_data.to_dict()
            cost.append(cost_item)

        status = self.status.value

        enabled = self.enabled

        limit = self.limit.to_dict()

        family = self.family

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "apiID": api_id,
                "providerID": provider_id,
                "name": name,
                "endpoint": endpoint,
                "capabilities": capabilities,
                "options": options,
                "variants": variants,
                "time": time,
                "cost": cost,
                "status": status,
                "enabled": enabled,
                "limit": limit,
            }
        )
        if family is not UNSET:
            field_dict["family"] = family

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_v2_info_capabilities import ModelV2InfoCapabilities
        from ..models.model_v2_info_cost_item import ModelV2InfoCostItem
        from ..models.model_v2_info_endpoint_type_0 import ModelV2InfoEndpointType0
        from ..models.model_v2_info_endpoint_type_1 import ModelV2InfoEndpointType1
        from ..models.model_v2_info_endpoint_type_2 import ModelV2InfoEndpointType2
        from ..models.model_v2_info_endpoint_type_3 import ModelV2InfoEndpointType3
        from ..models.model_v2_info_endpoint_type_4 import ModelV2InfoEndpointType4
        from ..models.model_v2_info_limit import ModelV2InfoLimit
        from ..models.model_v2_info_options import ModelV2InfoOptions
        from ..models.model_v2_info_time import ModelV2InfoTime
        from ..models.model_v2_info_variants_item import ModelV2InfoVariantsItem

        d = dict(src_dict)
        id = d.pop("id")

        api_id = d.pop("apiID")

        provider_id = d.pop("providerID")

        name = d.pop("name")

        def _parse_endpoint(
            data: object,
        ) -> (
            ModelV2InfoEndpointType0
            | ModelV2InfoEndpointType1
            | ModelV2InfoEndpointType2
            | ModelV2InfoEndpointType3
            | ModelV2InfoEndpointType4
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_0 = ModelV2InfoEndpointType0.from_dict(data)

                return endpoint_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_1 = ModelV2InfoEndpointType1.from_dict(data)

                return endpoint_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_2 = ModelV2InfoEndpointType2.from_dict(data)

                return endpoint_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_3 = ModelV2InfoEndpointType3.from_dict(data)

                return endpoint_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            endpoint_type_4 = ModelV2InfoEndpointType4.from_dict(data)

            return endpoint_type_4

        endpoint = _parse_endpoint(d.pop("endpoint"))

        capabilities = ModelV2InfoCapabilities.from_dict(d.pop("capabilities"))

        options = ModelV2InfoOptions.from_dict(d.pop("options"))

        variants = []
        _variants = d.pop("variants")
        for variants_item_data in _variants:
            variants_item = ModelV2InfoVariantsItem.from_dict(variants_item_data)

            variants.append(variants_item)

        time = ModelV2InfoTime.from_dict(d.pop("time"))

        cost = []
        _cost = d.pop("cost")
        for cost_item_data in _cost:
            cost_item = ModelV2InfoCostItem.from_dict(cost_item_data)

            cost.append(cost_item)

        status = ModelV2InfoStatus(d.pop("status"))

        enabled = d.pop("enabled")

        limit = ModelV2InfoLimit.from_dict(d.pop("limit"))

        family = d.pop("family", UNSET)

        model_v2_info = cls(
            id=id,
            api_id=api_id,
            provider_id=provider_id,
            name=name,
            endpoint=endpoint,
            capabilities=capabilities,
            options=options,
            variants=variants,
            time=time,
            cost=cost,
            status=status,
            enabled=enabled,
            limit=limit,
            family=family,
        )

        return model_v2_info
