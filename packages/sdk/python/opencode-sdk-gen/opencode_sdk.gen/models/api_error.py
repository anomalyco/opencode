from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.api_error_name import APIErrorName

if TYPE_CHECKING:
    from ..models.api_error_data import APIErrorData


T = TypeVar("T", bound="APIError")


@_attrs_define
class APIError:
    """
    Attributes:
        name (APIErrorName):
        data (APIErrorData):
    """

    name: APIErrorName
    data: APIErrorData

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
        from ..models.api_error_data import APIErrorData

        d = dict(src_dict)
        name = APIErrorName(d.pop("name"))

        data = APIErrorData.from_dict(d.pop("data"))

        api_error = cls(
            name=name,
            data=data,
        )

        return api_error
