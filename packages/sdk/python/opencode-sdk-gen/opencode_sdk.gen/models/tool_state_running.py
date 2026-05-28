from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.tool_state_running_status import ToolStateRunningStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.tool_state_running_input import ToolStateRunningInput
    from ..models.tool_state_running_metadata import ToolStateRunningMetadata
    from ..models.tool_state_running_time import ToolStateRunningTime


T = TypeVar("T", bound="ToolStateRunning")


@_attrs_define
class ToolStateRunning:
    """
    Attributes:
        status (ToolStateRunningStatus):
        input_ (ToolStateRunningInput):
        time (ToolStateRunningTime):
        title (str | Unset):
        metadata (ToolStateRunningMetadata | Unset):
    """

    status: ToolStateRunningStatus
    input_: ToolStateRunningInput
    time: ToolStateRunningTime
    title: str | Unset = UNSET
    metadata: ToolStateRunningMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        input_ = self.input_.to_dict()

        time = self.time.to_dict()

        title = self.title

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "input": input_,
                "time": time,
            }
        )
        if title is not UNSET:
            field_dict["title"] = title
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.tool_state_running_input import ToolStateRunningInput
        from ..models.tool_state_running_metadata import ToolStateRunningMetadata
        from ..models.tool_state_running_time import ToolStateRunningTime

        d = dict(src_dict)
        status = ToolStateRunningStatus(d.pop("status"))

        input_ = ToolStateRunningInput.from_dict(d.pop("input"))

        time = ToolStateRunningTime.from_dict(d.pop("time"))

        title = d.pop("title", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: ToolStateRunningMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = ToolStateRunningMetadata.from_dict(_metadata)

        tool_state_running = cls(
            status=status,
            input_=input_,
            time=time,
            title=title,
            metadata=metadata,
        )

        return tool_state_running
