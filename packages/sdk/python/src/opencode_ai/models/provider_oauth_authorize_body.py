from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_oauth_authorize_body_inputs import ProviderOauthAuthorizeBodyInputs


T = TypeVar("T", bound="ProviderOauthAuthorizeBody")


@_attrs_define
class ProviderOauthAuthorizeBody:
    """
    Attributes:
        method (float): Auth method index
        inputs (ProviderOauthAuthorizeBodyInputs | Unset): Prompt inputs
    """

    method: float
    inputs: ProviderOauthAuthorizeBodyInputs | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_oauth_authorize_body_inputs import ProviderOauthAuthorizeBodyInputs

        method = self.method

        inputs: dict[str, Any] | Unset = UNSET
        if not isinstance(self.inputs, Unset):
            inputs = self.inputs.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        provider_oauth_authorize_body.additional_properties = d
        return provider_oauth_authorize_body

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
