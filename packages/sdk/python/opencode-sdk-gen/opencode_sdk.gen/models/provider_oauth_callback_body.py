from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderOauthCallbackBody")


@_attrs_define
class ProviderOauthCallbackBody:
    """
    Attributes:
        method (float): Auth method index
        code (str | Unset):
    """

    method: float
    code: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        method = self.method

        code = self.code

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "method": method,
            }
        )
        if code is not UNSET:
            field_dict["code"] = code

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        method = d.pop("method")

        code = d.pop("code", UNSET)

        provider_oauth_callback_body = cls(
            method=method,
            code=code,
        )

        return provider_oauth_callback_body
