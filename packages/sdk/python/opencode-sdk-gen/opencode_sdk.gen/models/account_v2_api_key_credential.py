from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.account_v2_api_key_credential_type import AccountV2ApiKeyCredentialType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.account_v2_api_key_credential_metadata import AccountV2ApiKeyCredentialMetadata


T = TypeVar("T", bound="AccountV2ApiKeyCredential")


@_attrs_define
class AccountV2ApiKeyCredential:
    """
    Attributes:
        type_ (AccountV2ApiKeyCredentialType):
        key (str):
        metadata (AccountV2ApiKeyCredentialMetadata | Unset):
    """

    type_: AccountV2ApiKeyCredentialType
    key: str
    metadata: AccountV2ApiKeyCredentialMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        key = self.key

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "key": key,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.account_v2_api_key_credential_metadata import AccountV2ApiKeyCredentialMetadata

        d = dict(src_dict)
        type_ = AccountV2ApiKeyCredentialType(d.pop("type"))

        key = d.pop("key")

        _metadata = d.pop("metadata", UNSET)
        metadata: AccountV2ApiKeyCredentialMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = AccountV2ApiKeyCredentialMetadata.from_dict(_metadata)

        account_v2_api_key_credential = cls(
            type_=type_,
            key=key,
            metadata=metadata,
        )

        return account_v2_api_key_credential
