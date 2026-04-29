from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_auth_metadata import ApiAuthMetadata


T = TypeVar("T", bound="ApiAuth")


@_attrs_define
class ApiAuth:
    """
    Attributes:
        type_ (Literal['api']):
        key (str):
        metadata (ApiAuthMetadata | Unset):
    """

    type_: Literal["api"]
    key: str
    metadata: ApiAuthMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.api_auth_metadata import ApiAuthMetadata

        type_ = self.type_

        key = self.key

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        type_ = cast(Literal["api"], d.pop("type"))
        if type_ != "api":
            raise ValueError(f"type must match const 'api', got '{type_}'")

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

        api_auth.additional_properties = d
        return api_auth

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
