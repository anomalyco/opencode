from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.api_auth_type import ApiAuthType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_auth_metadata import ApiAuthMetadata


T = TypeVar("T", bound="ApiAuth")


@_attrs_define
class ApiAuth:
    """
    Attributes:
        type_ (ApiAuthType):
        key (str):
        metadata (ApiAuthMetadata | Unset):
    """

    type_: ApiAuthType
    key: str
    metadata: ApiAuthMetadata | Unset = UNSET

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
        from ..models.api_auth_metadata import ApiAuthMetadata

        d = dict(src_dict)
        type_ = ApiAuthType(d.pop("type"))

        key = d.pop("key")

        _metadata = d.pop("metadata", UNSET)
        metadata: ApiAuthMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = ApiAuthMetadata.from_dict(_metadata)

        api_auth = cls(
            type_=type_,
            key=key,
            metadata=metadata,
        )

        return api_auth
