from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.unknown_error_name import UnknownErrorName

if TYPE_CHECKING:
    from ..models.unknown_error_data import UnknownErrorData


T = TypeVar("T", bound="UnknownError")


@_attrs_define
class UnknownError:
    """
    Attributes:
        name (UnknownErrorName):
        data (UnknownErrorData):
    """

    name: UnknownErrorName
    data: UnknownErrorData

    def to_dict(self) -> dict[str, Any]:
        name = self.name.value

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.unknown_error_data import UnknownErrorData

        d = dict(src_dict)
        name = UnknownErrorName(d.pop("name"))

        data = UnknownErrorData.from_dict(d.pop("data"))

        unknown_error = cls(
            name=name,
            data=data,
        )

        return unknown_error
