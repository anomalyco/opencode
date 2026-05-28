from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionCreateBodyModel")


@_attrs_define
class SessionCreateBodyModel:
    """
    Attributes:
        id (str):
        provider_id (str):
        variant (str | Unset):
    """

    id: str
    provider_id: str
    variant: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        provider_id = self.provider_id

        variant = self.variant

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "providerID": provider_id,
            }
        )
        if variant is not UNSET:
            field_dict["variant"] = variant

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        provider_id = d.pop("providerID")

        variant = d.pop("variant", UNSET)

        session_create_body_model = cls(
            id=id,
            provider_id=provider_id,
            variant=variant,
        )

        return session_create_body_model
