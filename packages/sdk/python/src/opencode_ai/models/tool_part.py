from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.tool_state_completed import ToolStateCompleted
    from ..models.tool_state_error import ToolStateError
    from ..models.tool_state_pending import ToolStatePending
    from ..models.tool_state_running import ToolStateRunning


T = TypeVar("T", bound="ToolPart")


@_attrs_define
class ToolPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (Literal['tool']):
        call_id (str):
        tool (str):
        state (Union['ToolStateCompleted', 'ToolStateError', 'ToolStatePending', 'ToolStateRunning']):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["tool"]
    call_id: str
    tool: str
    state: Union["ToolStateCompleted", "ToolStateError", "ToolStatePending", "ToolStateRunning"]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.tool_state_completed import ToolStateCompleted
        from ..models.tool_state_pending import ToolStatePending
        from ..models.tool_state_running import ToolStateRunning

        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        call_id = self.call_id

        tool = self.tool

        state: dict[str, Any]
        if isinstance(self.state, ToolStatePending):
            state = self.state.to_dict()
        elif isinstance(self.state, ToolStateRunning):
            state = self.state.to_dict()
        elif isinstance(self.state, ToolStateCompleted):
            state = self.state.to_dict()
        else:
            state = self.state.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "callID": call_id,
                "tool": tool,
                "state": state,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.tool_state_completed import ToolStateCompleted
        from ..models.tool_state_error import ToolStateError
        from ..models.tool_state_pending import ToolStatePending
        from ..models.tool_state_running import ToolStateRunning

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = cast(Literal["tool"], d.pop("type"))
        if type_ != "tool":
            raise ValueError(f"type must match const 'tool', got '{type_}'")

        call_id = d.pop("callID")

        tool = d.pop("tool")

        def _parse_state(
            data: object,
        ) -> Union["ToolStateCompleted", "ToolStateError", "ToolStatePending", "ToolStateRunning"]:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_tool_state_type_0 = ToolStatePending.from_dict(data)

                return componentsschemas_tool_state_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_tool_state_type_1 = ToolStateRunning.from_dict(data)

                return componentsschemas_tool_state_type_1
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_tool_state_type_2 = ToolStateCompleted.from_dict(data)

                return componentsschemas_tool_state_type_2
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_tool_state_type_3 = ToolStateError.from_dict(data)

            return componentsschemas_tool_state_type_3

        state = _parse_state(d.pop("state"))

        tool_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            call_id=call_id,
            tool=tool,
            state=state,
        )

        tool_part.additional_properties = d
        return tool_part

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
