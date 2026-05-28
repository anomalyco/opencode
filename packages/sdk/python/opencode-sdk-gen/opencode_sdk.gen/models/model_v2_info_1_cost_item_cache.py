from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ModelV2Info1CostItemCache")


@_attrs_define
class ModelV2Info1CostItemCache:
    """
    Attributes:
        read (float):
        write (float):
    """

    read: float
    write: float

    def to_dict(self) -> dict[str, Any]:
        read = self.read

        write = self.write

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "read": read,
                "write": write,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        read = d.pop("read")

        write = d.pop("write")

        model_v2_info_1_cost_item_cache = cls(
            read=read,
            write=write,
        )

        return model_v2_info_1_cost_item_cache
