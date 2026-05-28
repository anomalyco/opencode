from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.model_v2_info_1_status import ModelV2Info1Status
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_v2_info_1_capabilities import ModelV2Info1Capabilities
    from ..models.model_v2_info_1_cost_item import ModelV2Info1CostItem
    from ..models.model_v2_info_1_endpoint_type_0 import ModelV2Info1EndpointType0
    from ..models.model_v2_info_1_endpoint_type_1 import ModelV2Info1EndpointType1
    from ..models.model_v2_info_1_endpoint_type_2 import ModelV2Info1EndpointType2
    from ..models.model_v2_info_1_endpoint_type_3 import ModelV2Info1EndpointType3
    from ..models.model_v2_info_1_endpoint_type_4 import ModelV2Info1EndpointType4
    from ..models.model_v2_info_1_limit import ModelV2Info1Limit
    from ..models.model_v2_info_1_options import ModelV2Info1Options
    from ..models.model_v2_info_1_time import ModelV2Info1Time
    from ..models.model_v2_info_1_variants_item import ModelV2Info1VariantsItem


T = TypeVar("T", bound="ModelV2Info1")


@_attrs_define
class ModelV2Info1:
    """
    Attributes:
        id (str):
        api_id (str):
        provider_id (str):
        name (str):
        endpoint (ModelV2Info1EndpointType0 | ModelV2Info1EndpointType1 | ModelV2Info1EndpointType2 |
            ModelV2Info1EndpointType3 | ModelV2Info1EndpointType4):
        capabilities (ModelV2Info1Capabilities):
        options (ModelV2Info1Options):
        variants (list[ModelV2Info1VariantsItem]):
        time (ModelV2Info1Time):
        cost (list[ModelV2Info1CostItem]):
        status (ModelV2Info1Status):
        enabled (bool):
        limit (ModelV2Info1Limit):
        family (str | Unset):
    """

    id: str
    api_id: str
    provider_id: str
    name: str
    endpoint: (
        ModelV2Info1EndpointType0
        | ModelV2Info1EndpointType1
        | ModelV2Info1EndpointType2
        | ModelV2Info1EndpointType3
        | ModelV2Info1EndpointType4
    )
    capabilities: ModelV2Info1Capabilities
    options: ModelV2Info1Options
    variants: list[ModelV2Info1VariantsItem]
    time: ModelV2Info1Time
    cost: list[ModelV2Info1CostItem]
    status: ModelV2Info1Status
    enabled: bool
    limit: ModelV2Info1Limit
    family: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.model_v2_info_1_endpoint_type_0 import ModelV2Info1EndpointType0
        from ..models.model_v2_info_1_endpoint_type_1 import ModelV2Info1EndpointType1
        from ..models.model_v2_info_1_endpoint_type_2 import ModelV2Info1EndpointType2
        from ..models.model_v2_info_1_endpoint_type_3 import ModelV2Info1EndpointType3

        id = self.id

        api_id = self.api_id

        provider_id = self.provider_id

        name = self.name

        endpoint: dict[str, Any]
        if isinstance(self.endpoint, ModelV2Info1EndpointType0):
            endpoint = self.endpoint.to_dict()
        elif isinstance(self.endpoint, ModelV2Info1EndpointType1):
            endpoint = self.endpoint.to_dict()
        elif isinstance(self.endpoint, ModelV2Info1EndpointType2):
            endpoint = self.endpoint.to_dict()
        elif isinstance(self.endpoint, ModelV2Info1EndpointType3):
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
        from ..models.model_v2_info_1_capabilities import ModelV2Info1Capabilities
        from ..models.model_v2_info_1_cost_item import ModelV2Info1CostItem
        from ..models.model_v2_info_1_endpoint_type_0 import ModelV2Info1EndpointType0
        from ..models.model_v2_info_1_endpoint_type_1 import ModelV2Info1EndpointType1
        from ..models.model_v2_info_1_endpoint_type_2 import ModelV2Info1EndpointType2
        from ..models.model_v2_info_1_endpoint_type_3 import ModelV2Info1EndpointType3
        from ..models.model_v2_info_1_endpoint_type_4 import ModelV2Info1EndpointType4
        from ..models.model_v2_info_1_limit import ModelV2Info1Limit
        from ..models.model_v2_info_1_options import ModelV2Info1Options
        from ..models.model_v2_info_1_time import ModelV2Info1Time
        from ..models.model_v2_info_1_variants_item import ModelV2Info1VariantsItem

        d = dict(src_dict)
        id = d.pop("id")

        api_id = d.pop("apiID")

        provider_id = d.pop("providerID")

        name = d.pop("name")

        def _parse_endpoint(
            data: object,
        ) -> (
            ModelV2Info1EndpointType0
            | ModelV2Info1EndpointType1
            | ModelV2Info1EndpointType2
            | ModelV2Info1EndpointType3
            | ModelV2Info1EndpointType4
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_0 = ModelV2Info1EndpointType0.from_dict(data)

                return endpoint_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_1 = ModelV2Info1EndpointType1.from_dict(data)

                return endpoint_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_2 = ModelV2Info1EndpointType2.from_dict(data)

                return endpoint_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_3 = ModelV2Info1EndpointType3.from_dict(data)

                return endpoint_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            endpoint_type_4 = ModelV2Info1EndpointType4.from_dict(data)

            return endpoint_type_4

        endpoint = _parse_endpoint(d.pop("endpoint"))

        capabilities = ModelV2Info1Capabilities.from_dict(d.pop("capabilities"))

        options = ModelV2Info1Options.from_dict(d.pop("options"))

        variants = []
        _variants = d.pop("variants")
        for variants_item_data in _variants:
            variants_item = ModelV2Info1VariantsItem.from_dict(variants_item_data)

            variants.append(variants_item)

        time = ModelV2Info1Time.from_dict(d.pop("time"))

        cost = []
        _cost = d.pop("cost")
        for cost_item_data in _cost:
            cost_item = ModelV2Info1CostItem.from_dict(cost_item_data)

            cost.append(cost_item)

        status = ModelV2Info1Status(d.pop("status"))

        enabled = d.pop("enabled")

        limit = ModelV2Info1Limit.from_dict(d.pop("limit"))

        family = d.pop("family", UNSET)

        model_v2_info_1 = cls(
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

        return model_v2_info_1
