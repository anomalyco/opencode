from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_oauth_authorize_body_inputs import ProviderOauthAuthorizeBodyInputs


T = TypeVar("T", bound="ProviderOauthAuthorizeBody")


@_attrs_define
class ProviderOauthAuthorizeBody:
    """
    Attributes:
        method (float): Auth method index
        inputs (ProviderOauthAuthorizeBodyInputs | Unset):
    """

    method: float
    inputs: ProviderOauthAuthorizeBodyInputs | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        method = self.method

        inputs: dict[str, Any] | Unset = UNSET
        if not isinstance(self.inputs, Unset):
            inputs = self.inputs.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "method": method,
            }
        )
        if inputs is not UNSET:
            field_dict["inputs"] = inputs

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_oauth_authorize_body_inputs import ProviderOauthAuthorizeBodyInputs

        d = dict(src_dict)
        method = d.pop("method")

        _inputs = d.pop("inputs", UNSET)
        inputs: ProviderOauthAuthorizeBodyInputs | Unset
        if isinstance(_inputs, Unset):
            inputs = UNSET
        else:
            inputs = ProviderOauthAuthorizeBodyInputs.from_dict(_inputs)

        provider_oauth_authorize_body = cls(
            method=method,
            inputs=inputs,
        )

        return provider_oauth_authorize_body
