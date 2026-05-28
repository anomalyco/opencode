from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.context_overflow_error_name import ContextOverflowErrorName

if TYPE_CHECKING:
    from ..models.context_overflow_error_data import ContextOverflowErrorData


T = TypeVar("T", bound="ContextOverflowError")


@_attrs_define
class ContextOverflowError:
    """
    Attributes:
        name (ContextOverflowErrorName):
        data (ContextOverflowErrorData):
    """

    name: ContextOverflowErrorName
    data: ContextOverflowErrorData

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
        from ..models.context_overflow_error_data import ContextOverflowErrorData

        d = dict(src_dict)
        name = ContextOverflowErrorName(d.pop("name"))

        data = ContextOverflowErrorData.from_dict(d.pop("data"))

        context_overflow_error = cls(
            name=name,
            data=data,
        )

        return context_overflow_error
