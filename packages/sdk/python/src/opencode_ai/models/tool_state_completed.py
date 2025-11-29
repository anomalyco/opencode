from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
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
    """

    status: Literal["completed"]
    input_: "ToolStateCompletedInput"
    output: str
    title: str
    metadata: "ToolStateCompletedMetadata"
    time: "ToolStateCompletedTime"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        input_ = self.input_.to_dict()

        output = self.output

        title = self.title

        metadata = self.metadata.to_dict()

        time = self.time.to_dict()

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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
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

        tool_state_completed = cls(
            status=status,
            input_=input_,
            output=output,
            title=title,
            metadata=metadata,
            time=time,
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
