from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.tool_state_completed_status import ToolStateCompletedStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.file_part import FilePart
    from ..models.tool_state_completed_input import ToolStateCompletedInput
    from ..models.tool_state_completed_metadata import ToolStateCompletedMetadata
    from ..models.tool_state_completed_time import ToolStateCompletedTime


T = TypeVar("T", bound="ToolStateCompleted")


@_attrs_define
class ToolStateCompleted:
    """
    Attributes:
        status (ToolStateCompletedStatus):
        input_ (ToolStateCompletedInput):
        output (str):
        title (str):
        metadata (ToolStateCompletedMetadata):
        time (ToolStateCompletedTime):
        attachments (list[FilePart] | Unset):
    """

    status: ToolStateCompletedStatus
    input_: ToolStateCompletedInput
    output: str
    title: str
    metadata: ToolStateCompletedMetadata
    time: ToolStateCompletedTime
    attachments: list[FilePart] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        input_ = self.input_.to_dict()

        output = self.output

        title = self.title

        metadata = self.metadata.to_dict()

        time = self.time.to_dict()

        attachments: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.attachments, Unset):
            attachments = []
            for attachments_item_data in self.attachments:
                attachments_item = attachments_item_data.to_dict()
                attachments.append(attachments_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "input": input_,
                "output": output,
                "title": title,
                "metadata": metadata,
                "time": time,
            }
        )
        if attachments is not UNSET:
            field_dict["attachments"] = attachments

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_part import FilePart
        from ..models.tool_state_completed_input import ToolStateCompletedInput
        from ..models.tool_state_completed_metadata import ToolStateCompletedMetadata
        from ..models.tool_state_completed_time import ToolStateCompletedTime

        d = dict(src_dict)
        status = ToolStateCompletedStatus(d.pop("status"))

        input_ = ToolStateCompletedInput.from_dict(d.pop("input"))

        output = d.pop("output")

        title = d.pop("title")

        metadata = ToolStateCompletedMetadata.from_dict(d.pop("metadata"))

        time = ToolStateCompletedTime.from_dict(d.pop("time"))

        _attachments = d.pop("attachments", UNSET)
        attachments: list[FilePart] | Unset = UNSET
        if _attachments is not UNSET:
            attachments = []
            for attachments_item_data in _attachments:
                attachments_item = FilePart.from_dict(attachments_item_data)

                attachments.append(attachments_item)

        tool_state_completed = cls(
            status=status,
            input_=input_,
            output=output,
            title=title,
            metadata=metadata,
            time=time,
            attachments=attachments,
        )

        return tool_state_completed
