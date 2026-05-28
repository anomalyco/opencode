from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.agent_part import AgentPart
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


T = TypeVar("T", bound="SyncEventMessagePartUpdatedData")


@_attrs_define
class SyncEventMessagePartUpdatedData:
    """
    Attributes:
        session_id (str):
        part (AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart | SnapshotPart |
            StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart):
        time (int):
    """

    session_id: str
    part: (
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
    )
    time: int

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

        session_id = self.session_id

        part: dict[str, Any]
        if isinstance(self.part, TextPart):
            part = self.part.to_dict()
        elif isinstance(self.part, SubtaskPart):
            part = self.part.to_dict()
        elif isinstance(self.part, ReasoningPart):
            part = self.part.to_dict()
        elif isinstance(self.part, FilePart):
            part = self.part.to_dict()
        elif isinstance(self.part, ToolPart):
            part = self.part.to_dict()
        elif isinstance(self.part, StepStartPart):
            part = self.part.to_dict()
        elif isinstance(self.part, StepFinishPart):
            part = self.part.to_dict()
        elif isinstance(self.part, SnapshotPart):
            part = self.part.to_dict()
        elif isinstance(self.part, PatchPart):
            part = self.part.to_dict()
        elif isinstance(self.part, AgentPart):
            part = self.part.to_dict()
        elif isinstance(self.part, RetryPart):
            part = self.part.to_dict()
        else:
            part = self.part.to_dict()

        time = self.time

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionID": session_id,
                "part": part,
                "time": time,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_part import AgentPart
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
        session_id = d.pop("sessionID")

        def _parse_part(
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

        part = _parse_part(d.pop("part"))

        time = d.pop("time")

        sync_event_message_part_updated_data = cls(
            session_id=session_id,
            part=part,
            time=time,
        )

        return sync_event_message_part_updated_data
