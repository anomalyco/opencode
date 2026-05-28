from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.tool_state_pending_status import ToolStatePendingStatus

if TYPE_CHECKING:
    from ..models.tool_state_pending_input import ToolStatePendingInput


T = TypeVar("T", bound="ToolStatePending")


@_attrs_define
class ToolStatePending:
    """
    Attributes:
        status (ToolStatePendingStatus):
        input_ (ToolStatePendingInput):
        raw (str):
    """

    status: ToolStatePendingStatus
    input_: ToolStatePendingInput
    raw: str

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        input_ = self.input_.to_dict()

        raw = self.raw

        field_dict: dict[str, Any] = {}

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
        status = ToolStatePendingStatus(d.pop("status"))

        input_ = ToolStatePendingInput.from_dict(d.pop("input"))

        raw = d.pop("raw")

        tool_state_pending = cls(
            status=status,
            input_=input_,
            raw=raw,
        )

        return tool_state_pending
