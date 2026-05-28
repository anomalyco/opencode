from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.tool_part_type import ToolPartType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.tool_part_metadata import ToolPartMetadata
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
        type_ (ToolPartType):
        call_id (str):
        tool (str):
        state (ToolStateCompleted | ToolStateError | ToolStatePending | ToolStateRunning):
        metadata (ToolPartMetadata | Unset):
    """

    id: str
    session_id: str
    message_id: str
    type_: ToolPartType
    call_id: str
    tool: str
    state: ToolStateCompleted | ToolStateError | ToolStatePending | ToolStateRunning
    metadata: ToolPartMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.tool_state_completed import ToolStateCompleted
        from ..models.tool_state_pending import ToolStatePending
        from ..models.tool_state_running import ToolStateRunning

        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

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

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

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
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.tool_part_metadata import ToolPartMetadata
        from ..models.tool_state_completed import ToolStateCompleted
        from ..models.tool_state_error import ToolStateError
        from ..models.tool_state_pending import ToolStatePending
        from ..models.tool_state_running import ToolStateRunning

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = ToolPartType(d.pop("type"))

        call_id = d.pop("callID")

        tool = d.pop("tool")

        def _parse_state(data: object) -> ToolStateCompleted | ToolStateError | ToolStatePending | ToolStateRunning:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_tool_state_type_0 = ToolStatePending.from_dict(data)

                return componentsschemas_tool_state_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_tool_state_type_1 = ToolStateRunning.from_dict(data)

                return componentsschemas_tool_state_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_tool_state_type_2 = ToolStateCompleted.from_dict(data)

                return componentsschemas_tool_state_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_tool_state_type_3 = ToolStateError.from_dict(data)

            return componentsschemas_tool_state_type_3

        state = _parse_state(d.pop("state"))

        _metadata = d.pop("metadata", UNSET)
        metadata: ToolPartMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = ToolPartMetadata.from_dict(_metadata)

        tool_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            call_id=call_id,
            tool=tool,
            state=state,
            metadata=metadata,
        )

        return tool_part
