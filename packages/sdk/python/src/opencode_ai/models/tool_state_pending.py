from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.tool_state_pending_input import ToolStatePendingInput


T = TypeVar("T", bound="ToolStatePending")


@_attrs_define
class ToolStatePending:
    """
    Attributes:
        status (Literal['pending']):
        input_ (ToolStatePendingInput):
        raw (str):
    """

    status: Literal["pending"]
    input_: ToolStatePendingInput
    raw: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.tool_state_pending_input import ToolStatePendingInput

        status = self.status

        input_ = self.input_.to_dict()

        raw = self.raw

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
                "input": input_,
                "raw": raw,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.tool_state_pending_input import ToolStatePendingInput

        d = dict(src_dict)
        status = cast(Literal["pending"], d.pop("status"))
        if status != "pending":
            raise ValueError(f"status must match const 'pending', got '{status}'")

        input_ = ToolStatePendingInput.from_dict(d.pop("input"))

        raw = d.pop("raw")

        tool_state_pending = cls(
            status=status,
            input_=input_,
            raw=raw,
        )

        tool_state_pending.additional_properties = d
        return tool_state_pending

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
