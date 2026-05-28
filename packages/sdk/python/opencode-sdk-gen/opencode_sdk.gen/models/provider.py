from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        source = self.source.value

        env = self.env

        options = self.options.to_dict()

        models = self.models.to_dict()

        key = self.key

        field_dict: dict[str, Any] = {}

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

        return provider
