from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

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
    from ..models.user_message import UserMessage


T = TypeVar("T", bound="SessionMessagesResponse200Item")


@_attrs_define
class SessionMessagesResponse200Item:
    """
    Attributes:
        info (AssistantMessage | UserMessage):
        parts (list[AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart | SnapshotPart |
            StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart]):
    """

    info: AssistantMessage | UserMessage
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
        from ..models.user_message import UserMessage

        info: dict[str, Any]
        if isinstance(self.info, UserMessage):
            info = self.info.to_dict()
        else:
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
        from ..models.user_message import UserMessage

        d = dict(src_dict)

        def _parse_info(data: object) -> AssistantMessage | UserMessage:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_message_type_0 = UserMessage.from_dict(data)

                return componentsschemas_message_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_message_type_1 = AssistantMessage.from_dict(data)

            return componentsschemas_message_type_1

        info = _parse_info(d.pop("info"))

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

        session_messages_response_200_item = cls(
            info=info,
            parts=parts,
        )

        return session_messages_response_200_item
