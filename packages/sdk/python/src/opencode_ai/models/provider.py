from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.provider_source import ProviderSource
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_models import ProviderModels
    from ..models.provider_options import ProviderOptions


T = TypeVar("T", bound="Provider")


@_attrs_define
class Provider:
    """
    Attributes:
        id (str):
        name (str):
        source (ProviderSource):
        env (list[str]):
        options (ProviderOptions):
        models (ProviderModels):
        key (str | Unset):
    """

    id: str
    name: str
    source: ProviderSource
    env: list[str]
    options: ProviderOptions
    models: ProviderModels
    key: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_models import ProviderModels
        from ..models.provider_options import ProviderOptions

        id = self.id

        name = self.name

        source = self.source.value

        env = self.env

        options = self.options.to_dict()

        models = self.models.to_dict()

        key = self.key

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "source": source,
                "env": env,
                "options": options,
                "models": models,
            }
        )
        if key is not UNSET:
            field_dict["key"] = key

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_models import ProviderModels
        from ..models.provider_options import ProviderOptions

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        source = ProviderSource(d.pop("source"))

        env = cast(list[str], d.pop("env"))

        options = ProviderOptions.from_dict(d.pop("options"))

        models = ProviderModels.from_dict(d.pop("models"))

        key = d.pop("key", UNSET)

        provider = cls(
            id=id,
            name=name,
            source=source,
            env=env,
            options=options,
            models=models,
            key=key,
        )

        provider.additional_properties = d
        return provider

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
