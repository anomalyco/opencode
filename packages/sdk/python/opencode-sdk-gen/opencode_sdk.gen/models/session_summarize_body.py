from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionSummarizeBody")


@_attrs_define
class SessionSummarizeBody:
    """
    Attributes:
        provider_id (str):
        model_id (str):
        auto (bool | Unset):
    """

    provider_id: str
    model_id: str
    auto: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        provider_id = self.provider_id

        model_id = self.model_id

        auto = self.auto

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "providerID": provider_id,
                "modelID": model_id,
            }
        )
        if auto is not UNSET:
            field_dict["auto"] = auto

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        provider_id = d.pop("providerID")

        model_id = d.pop("modelID")

        auto = d.pop("auto", UNSET)

        session_summarize_body = cls(
            provider_id=provider_id,
            model_id=model_id,
            auto=auto,
        )

        return session_summarize_body
