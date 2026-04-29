from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_error_data import APIErrorData


T = TypeVar("T", bound="APIError")


@_attrs_define
class APIError:
    """
    Attributes:
        name (Literal['APIError']):
        data (APIErrorData):
    """

    name: Literal["APIError"]
    data: APIErrorData
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.api_error_data import APIErrorData

        name = self.name

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_error_data import APIErrorData

        d = dict(src_dict)
        name = cast(Literal["APIError"], d.pop("name"))
        if name != "APIError":
            raise ValueError(f"name must match const 'APIError', got '{name}'")

        data = APIErrorData.from_dict(d.pop("data"))

        api_error = cls(
            name=name,
            data=data,
        )

        api_error.additional_properties = d
        return api_error

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
