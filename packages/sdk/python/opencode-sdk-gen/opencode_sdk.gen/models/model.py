from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.model_status import ModelStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_api import ModelApi
    from ..models.model_capabilities import ModelCapabilities
    from ..models.model_cost import ModelCost
    from ..models.model_headers import ModelHeaders
    from ..models.model_limit import ModelLimit
    from ..models.model_options import ModelOptions
    from ..models.model_variants import ModelVariants


T = TypeVar("T", bound="Model")


@_attrs_define
class Model:
    """
    Attributes:
        id (str):
        provider_id (str):
        api (ModelApi):
        name (str):
        capabilities (ModelCapabilities):
        cost (ModelCost):
        limit (ModelLimit):
        status (ModelStatus):
        options (ModelOptions):
        headers (ModelHeaders):
        release_date (str):
        family (str | Unset):
        variants (ModelVariants | Unset):
    """

    id: str
    provider_id: str
    api: ModelApi
    name: str
    capabilities: ModelCapabilities
    cost: ModelCost
    limit: ModelLimit
    status: ModelStatus
    options: ModelOptions
    headers: ModelHeaders
    release_date: str
    family: str | Unset = UNSET
    variants: ModelVariants | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        provider_id = self.provider_id

        api = self.api.to_dict()

        name = self.name

        capabilities = self.capabilities.to_dict()

        cost = self.cost.to_dict()

        limit = self.limit.to_dict()

        status = self.status.value

        options = self.options.to_dict()

        headers = self.headers.to_dict()

        release_date = self.release_date

        family = self.family

        variants: dict[str, Any] | Unset = UNSET
        if not isinstance(self.variants, Unset):
            variants = self.variants.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "providerID": provider_id,
                "api": api,
                "name": name,
                "capabilities": capabilities,
                "cost": cost,
                "limit": limit,
                "status": status,
                "options": options,
                "headers": headers,
                "release_date": release_date,
            }
        )
        if family is not UNSET:
            field_dict["family"] = family
        if variants is not UNSET:
            field_dict["variants"] = variants

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_api import ModelApi
        from ..models.model_capabilities import ModelCapabilities
        from ..models.model_cost import ModelCost
        from ..models.model_headers import ModelHeaders
        from ..models.model_limit import ModelLimit
        from ..models.model_options import ModelOptions
        from ..models.model_variants import ModelVariants

        d = dict(src_dict)
        id = d.pop("id")

        provider_id = d.pop("providerID")

        api = ModelApi.from_dict(d.pop("api"))

        name = d.pop("name")

        capabilities = ModelCapabilities.from_dict(d.pop("capabilities"))

        cost = ModelCost.from_dict(d.pop("cost"))

        limit = ModelLimit.from_dict(d.pop("limit"))

        status = ModelStatus(d.pop("status"))

        options = ModelOptions.from_dict(d.pop("options"))

        headers = ModelHeaders.from_dict(d.pop("headers"))

        release_date = d.pop("release_date")

        family = d.pop("family", UNSET)

        _variants = d.pop("variants", UNSET)
        variants: ModelVariants | Unset
        if isinstance(_variants, Unset):
            variants = UNSET
        else:
            variants = ModelVariants.from_dict(_variants)

        model = cls(
            id=id,
            provider_id=provider_id,
            api=api,
            name=name,
            capabilities=capabilities,
            cost=cost,
            limit=limit,
            status=status,
            options=options,
            headers=headers,
            release_date=release_date,
            family=family,
            variants=variants,
        )

        return model
