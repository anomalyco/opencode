from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionSummarizeBody")


@_attrs_define
class SessionSummarizeBody:
    """
    Attributes:
        provider_id (str):
        model_id (str):
        auto (bool | Unset):  Default: False.
    """

    provider_id: str
    model_id: str
    auto: bool | Unset = False
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        provider_id = self.provider_id

        model_id = self.model_id

        auto = self.auto

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        session_summarize_body.additional_properties = d
        return session_summarize_body

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
