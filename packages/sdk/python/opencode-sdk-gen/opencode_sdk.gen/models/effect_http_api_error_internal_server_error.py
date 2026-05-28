from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.effect_http_api_error_internal_server_error_tag import EffectHttpApiErrorInternalServerErrorTag

T = TypeVar("T", bound="EffectHttpApiErrorInternalServerError")


@_attrs_define
class EffectHttpApiErrorInternalServerError:
    """
    Attributes:
        field_tag (EffectHttpApiErrorInternalServerErrorTag):
    """

    field_tag: EffectHttpApiErrorInternalServerErrorTag

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
        field_tag = EffectHttpApiErrorInternalServerErrorTag(d.pop("_tag"))

        effect_http_api_error_internal_server_error = cls(
            field_tag=field_tag,
        )

        return effect_http_api_error_internal_server_error
