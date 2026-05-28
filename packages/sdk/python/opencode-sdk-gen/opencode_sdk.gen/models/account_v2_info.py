from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.account_v2_api_key_credential import AccountV2ApiKeyCredential
    from ..models.account_v2o_auth_credential import AccountV2OAuthCredential


T = TypeVar("T", bound="AccountV2Info")


@_attrs_define
class AccountV2Info:
    """
    Attributes:
        id (str):
        service_id (str):
        description (str):
        credential (AccountV2ApiKeyCredential | AccountV2OAuthCredential):
    """

    id: str
    service_id: str
    description: str
    credential: AccountV2ApiKeyCredential | AccountV2OAuthCredential

    def to_dict(self) -> dict[str, Any]:
        from ..models.account_v2o_auth_credential import AccountV2OAuthCredential

        id = self.id

        service_id = self.service_id

        description = self.description

        credential: dict[str, Any]
        if isinstance(self.credential, AccountV2OAuthCredential):
            credential = self.credential.to_dict()
        else:
            credential = self.credential.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "serviceID": service_id,
                "description": description,
                "credential": credential,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.account_v2_api_key_credential import AccountV2ApiKeyCredential
        from ..models.account_v2o_auth_credential import AccountV2OAuthCredential

        d = dict(src_dict)
        id = d.pop("id")

        service_id = d.pop("serviceID")

        description = d.pop("description")

        def _parse_credential(data: object) -> AccountV2ApiKeyCredential | AccountV2OAuthCredential:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_account_v2_credential_type_0 = AccountV2OAuthCredential.from_dict(data)

                return componentsschemas_account_v2_credential_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_account_v2_credential_type_1 = AccountV2ApiKeyCredential.from_dict(data)

            return componentsschemas_account_v2_credential_type_1

        credential = _parse_credential(d.pop("credential"))

        account_v2_info = cls(
            id=id,
            service_id=service_id,
            description=description,
            credential=credential,
        )

        return account_v2_info
