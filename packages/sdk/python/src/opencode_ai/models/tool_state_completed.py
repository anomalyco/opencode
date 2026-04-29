from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        status (Literal['completed']):
        input_ (ToolStateCompletedInput):
        output (str):
        title (str):
        metadata (ToolStateCompletedMetadata):
        time (ToolStateCompletedTime):
        attachments (list[FilePart] | Unset):
    """

    status: Literal["completed"]
    input_: ToolStateCompletedInput
    output: str
    title: str
    metadata: ToolStateCompletedMetadata
    time: ToolStateCompletedTime
    attachments: list[FilePart] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.file_part import FilePart
        from ..models.tool_state_completed_input import ToolStateCompletedInput
        from ..models.tool_state_completed_metadata import ToolStateCompletedMetadata
        from ..models.tool_state_completed_time import ToolStateCompletedTime

        status = self.status

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
        field_dict.update(self.additional_properties)
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
        status = cast(Literal["completed"], d.pop("status"))
        if status != "completed":
            raise ValueError(f"status must match const 'completed', got '{status}'")

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

        tool_state_completed.additional_properties = d
        return tool_state_completed

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
