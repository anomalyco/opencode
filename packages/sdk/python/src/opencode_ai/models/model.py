from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_cost import ModelCost
    from ..models.model_limit import ModelLimit
    from ..models.model_options import ModelOptions
    from ..models.model_provider import ModelProvider


T = TypeVar("T", bound="Model")


@_attrs_define
class Model:
    """
    Attributes:
        id (str):
        name (str):
        release_date (str):
        attachment (bool):
        reasoning (bool):
        temperature (bool):
        tool_call (bool):
        cost (ModelCost):
        limit (ModelLimit):
        options (ModelOptions):
        experimental (Union[Unset, bool]):
        provider (Union[Unset, ModelProvider]):
    """

    id: str
    name: str
    release_date: str
    attachment: bool
    reasoning: bool
    temperature: bool
    tool_call: bool
    cost: "ModelCost"
    limit: "ModelLimit"
    options: "ModelOptions"
    experimental: Union[Unset, bool] = UNSET
    provider: Union[Unset, "ModelProvider"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        release_date = self.release_date

        attachment = self.attachment

        reasoning = self.reasoning

        temperature = self.temperature

        tool_call = self.tool_call

        cost = self.cost.to_dict()

        limit = self.limit.to_dict()

        options = self.options.to_dict()

        experimental = self.experimental

        provider: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.provider, Unset):
            provider = self.provider.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "release_date": release_date,
                "attachment": attachment,
                "reasoning": reasoning,
                "temperature": temperature,
                "tool_call": tool_call,
                "cost": cost,
                "limit": limit,
                "options": options,
            }
        )
        if experimental is not UNSET:
            field_dict["experimental"] = experimental
        if provider is not UNSET:
            field_dict["provider"] = provider

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_cost import ModelCost
        from ..models.model_limit import ModelLimit
        from ..models.model_options import ModelOptions
        from ..models.model_provider import ModelProvider

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        release_date = d.pop("release_date")

        attachment = d.pop("attachment")

        reasoning = d.pop("reasoning")

        temperature = d.pop("temperature")

        tool_call = d.pop("tool_call")

        cost = ModelCost.from_dict(d.pop("cost"))

        limit = ModelLimit.from_dict(d.pop("limit"))

        options = ModelOptions.from_dict(d.pop("options"))

        experimental = d.pop("experimental", UNSET)

        _provider = d.pop("provider", UNSET)
        provider: Union[Unset, ModelProvider]
        if isinstance(_provider, Unset):
            provider = UNSET
        else:
            provider = ModelProvider.from_dict(_provider)

        model = cls(
            id=id,
            name=name,
            release_date=release_date,
            attachment=attachment,
            reasoning=reasoning,
            temperature=temperature,
            tool_call=tool_call,
            cost=cost,
            limit=limit,
            options=options,
            experimental=experimental,
            provider=provider,
        )

        model.additional_properties = d
        return model

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
