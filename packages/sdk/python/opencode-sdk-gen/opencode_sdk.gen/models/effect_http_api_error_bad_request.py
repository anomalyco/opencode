from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.effect_http_api_error_bad_request_tag import EffectHttpApiErrorBadRequestTag

T = TypeVar("T", bound="EffectHttpApiErrorBadRequest")


@_attrs_define
class EffectHttpApiErrorBadRequest:
    """
    Attributes:
        field_tag (EffectHttpApiErrorBadRequestTag):
    """

    field_tag: EffectHttpApiErrorBadRequestTag

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = EffectHttpApiErrorBadRequestTag(d.pop("_tag"))

        effect_http_api_error_bad_request = cls(
            field_tag=field_tag,
        )

        return effect_http_api_error_bad_request
