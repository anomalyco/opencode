from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.tool_state_running_metadata import ToolStateRunningMetadata
    from ..models.tool_state_running_time import ToolStateRunningTime


T = TypeVar("T", bound="ToolStateRunning")


@_attrs_define
class ToolStateRunning:
    """
    Attributes:
        status (Literal['running']):
        input_ (Any):
        time (ToolStateRunningTime):
        title (Union[Unset, str]):
        metadata (Union[Unset, ToolStateRunningMetadata]):
    """

    status: Literal["running"]
    input_: Any
    time: "ToolStateRunningTime"
    title: Union[Unset, str] = UNSET
    metadata: Union[Unset, "ToolStateRunningMetadata"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        input_ = self.input_

        time = self.time.to_dict()

        title = self.title

        metadata: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.tool_state_running_metadata import ToolStateRunningMetadata
        from ..models.tool_state_running_time import ToolStateRunningTime

        d = dict(src_dict)
        status = cast(Literal["running"], d.pop("status"))
        if status != "running":
            raise ValueError(f"status must match const 'running', got '{status}'")

        input_ = d.pop("input")

        time = ToolStateRunningTime.from_dict(d.pop("time"))

        title = d.pop("title", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: Union[Unset, ToolStateRunningMetadata]
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

        tool_state_running.additional_properties = d
        return tool_state_running

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
