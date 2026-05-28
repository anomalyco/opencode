from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.agent_part import AgentPart
    from ..models.assistant_message import AssistantMessage
    from ..models.compaction_part import CompactionPart
    from ..models.file_part import FilePart
    from ..models.patch_part import PatchPart
    from ..models.reasoning_part import ReasoningPart
    from ..models.retry_part import RetryPart
    from ..models.snapshot_part import SnapshotPart
    from ..models.step_finish_part import StepFinishPart
    from ..models.step_start_part import StepStartPart
    from ..models.subtask_part import SubtaskPart
    from ..models.text_part import TextPart
    from ..models.tool_part import ToolPart


T = TypeVar("T", bound="SessionCommandResponse200")


@_attrs_define
class SessionCommandResponse200:
    """
    Attributes:
        info (AssistantMessage):
        parts (list[AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart | SnapshotPart |
            StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart]):
    """

    info: AssistantMessage
    parts: list[
        AgentPart
        | CompactionPart
        | FilePart
        | PatchPart
        | ReasoningPart
        | RetryPart
        | SnapshotPart
        | StepFinishPart
        | StepStartPart
        | SubtaskPart
        | TextPart
        | ToolPart
    ]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_part import AgentPart
        from ..models.file_part import FilePart
        from ..models.patch_part import PatchPart
        from ..models.reasoning_part import ReasoningPart
        from ..models.retry_part import RetryPart
        from ..models.snapshot_part import SnapshotPart
        from ..models.step_finish_part import StepFinishPart
        from ..models.step_start_part import StepStartPart
        from ..models.subtask_part import SubtaskPart
        from ..models.text_part import TextPart
        from ..models.tool_part import ToolPart

        info = self.info.to_dict()

        parts = []
        for parts_item_data in self.parts:
            parts_item: dict[str, Any]
            if isinstance(parts_item_data, TextPart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, SubtaskPart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, ReasoningPart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, FilePart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, ToolPart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, StepStartPart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, StepFinishPart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, SnapshotPart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, PatchPart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, AgentPart):
                parts_item = parts_item_data.to_dict()
            elif isinstance(parts_item_data, RetryPart):
                parts_item = parts_item_data.to_dict()
            else:
                parts_item = parts_item_data.to_dict()

            parts.append(parts_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "info": info,
                "parts": parts,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_part import AgentPart
        from ..models.assistant_message import AssistantMessage
        from ..models.compaction_part import CompactionPart
        from ..models.file_part import FilePart
        from ..models.patch_part import PatchPart
        from ..models.reasoning_part import ReasoningPart
        from ..models.retry_part import RetryPart
        from ..models.snapshot_part import SnapshotPart
        from ..models.step_finish_part import StepFinishPart
        from ..models.step_start_part import StepStartPart
        from ..models.subtask_part import SubtaskPart
        from ..models.text_part import TextPart
        from ..models.tool_part import ToolPart

        d = dict(src_dict)
        info = AssistantMessage.from_dict(d.pop("info"))

        parts = []
        _parts = d.pop("parts")
        for parts_item_data in _parts:

            def _parse_parts_item(
                data: object,
            ) -> (
                AgentPart
                | CompactionPart
                | FilePart
                | PatchPart
                | ReasoningPart
                | RetryPart
                | SnapshotPart
                | StepFinishPart
                | StepStartPart
                | SubtaskPart
                | TextPart
                | ToolPart
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_0 = TextPart.from_dict(data)

                    return componentsschemas_part_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_1 = SubtaskPart.from_dict(data)

                    return componentsschemas_part_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_2 = ReasoningPart.from_dict(data)

                    return componentsschemas_part_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_3 = FilePart.from_dict(data)

                    return componentsschemas_part_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_4 = ToolPart.from_dict(data)

                    return componentsschemas_part_type_4
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_5 = StepStartPart.from_dict(data)

                    return componentsschemas_part_type_5
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_6 = StepFinishPart.from_dict(data)

                    return componentsschemas_part_type_6
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_7 = SnapshotPart.from_dict(data)

                    return componentsschemas_part_type_7
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_8 = PatchPart.from_dict(data)

                    return componentsschemas_part_type_8
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_9 = AgentPart.from_dict(data)

                    return componentsschemas_part_type_9
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_part_type_10 = RetryPart.from_dict(data)

                    return componentsschemas_part_type_10
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_11 = CompactionPart.from_dict(data)

                return componentsschemas_part_type_11

            parts_item = _parse_parts_item(parts_item_data)

            parts.append(parts_item)

        session_command_response_200 = cls(
            info=info,
            parts=parts,
        )

        session_command_response_200.additional_properties = d
        return session_command_response_200

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
