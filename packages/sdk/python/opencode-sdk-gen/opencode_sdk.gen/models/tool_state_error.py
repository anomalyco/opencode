from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.tool_state_error_status import ToolStateErrorStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.tool_state_error_input import ToolStateErrorInput
    from ..models.tool_state_error_metadata import ToolStateErrorMetadata
    from ..models.tool_state_error_time import ToolStateErrorTime


T = TypeVar("T", bound="ToolStateError")


@_attrs_define
class ToolStateError:
    """
    Attributes:
        status (ToolStateErrorStatus):
        input_ (ToolStateErrorInput):
        error (str):
        time (ToolStateErrorTime):
        metadata (ToolStateErrorMetadata | Unset):
    """

    status: ToolStateErrorStatus
    input_: ToolStateErrorInput
    error: str
    time: ToolStateErrorTime
    metadata: ToolStateErrorMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        input_ = self.input_.to_dict()

        error = self.error

        time = self.time.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "input": input_,
                "error": error,
                "time": time,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.tool_state_error_input import ToolStateErrorInput
        from ..models.tool_state_error_metadata import ToolStateErrorMetadata
        from ..models.tool_state_error_time import ToolStateErrorTime

        d = dict(src_dict)
        status = ToolStateErrorStatus(d.pop("status"))

        input_ = ToolStateErrorInput.from_dict(d.pop("input"))

        error = d.pop("error")

        time = ToolStateErrorTime.from_dict(d.pop("time"))

        _metadata = d.pop("metadata", UNSET)
        metadata: ToolStateErrorMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = ToolStateErrorMetadata.from_dict(_metadata)

        tool_state_error = cls(
            status=status,
            input_=input_,
            error=error,
            time=time,
            metadata=metadata,
        )

        return tool_state_error
