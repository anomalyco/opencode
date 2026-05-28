from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.model_v2_info import ModelV2Info


T = TypeVar("T", bound="EventCatalogModelUpdatedProperties")


@_attrs_define
class EventCatalogModelUpdatedProperties:
    """
    Attributes:
        model (ModelV2Info):
    """

    model: ModelV2Info

    def to_dict(self) -> dict[str, Any]:
        model = self.model.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "model": model,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_v2_info import ModelV2Info

        d = dict(src_dict)
        model = ModelV2Info.from_dict(d.pop("model"))

        event_catalog_model_updated_properties = cls(
            model=model,
        )

        return event_catalog_model_updated_properties
