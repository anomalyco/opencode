from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        status (Literal['error']):
        input_ (ToolStateErrorInput):
        error (str):
        time (ToolStateErrorTime):
        metadata (Union[Unset, ToolStateErrorMetadata]):
    """

    status: Literal["error"]
    input_: "ToolStateErrorInput"
    error: str
    time: "ToolStateErrorTime"
    metadata: Union[Unset, "ToolStateErrorMetadata"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        input_ = self.input_.to_dict()

        error = self.error

        time = self.time.to_dict()

        metadata: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        status = cast(Literal["error"], d.pop("status"))
        if status != "error":
            raise ValueError(f"status must match const 'error', got '{status}'")

        input_ = ToolStateErrorInput.from_dict(d.pop("input"))

        error = d.pop("error")

        time = ToolStateErrorTime.from_dict(d.pop("time"))

        _metadata = d.pop("metadata", UNSET)
        metadata: Union[Unset, ToolStateErrorMetadata]
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

        tool_state_error.additional_properties = d
        return tool_state_error

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
