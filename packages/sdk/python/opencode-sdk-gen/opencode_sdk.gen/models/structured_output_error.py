from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.structured_output_error_name import StructuredOutputErrorName

if TYPE_CHECKING:
    from ..models.structured_output_error_data import StructuredOutputErrorData


T = TypeVar("T", bound="StructuredOutputError")


@_attrs_define
class StructuredOutputError:
    """
    Attributes:
        name (StructuredOutputErrorName):
        data (StructuredOutputErrorData):
    """

    name: StructuredOutputErrorName
    data: StructuredOutputErrorData

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
        from ..models.structured_output_error_data import StructuredOutputErrorData

        d = dict(src_dict)
        name = StructuredOutputErrorName(d.pop("name"))

        data = StructuredOutputErrorData.from_dict(d.pop("data"))

        structured_output_error = cls(
            name=name,
            data=data,
        )

        return structured_output_error
