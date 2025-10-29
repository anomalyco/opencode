from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.agent_part import AgentPart
    from ..models.file_part import FilePart
    from ..models.patch_part import PatchPart
    from ..models.reasoning_part import ReasoningPart
    from ..models.snapshot_part import SnapshotPart
    from ..models.step_finish_part import StepFinishPart
    from ..models.step_start_part import StepStartPart
    from ..models.text_part import TextPart
    from ..models.tool_part import ToolPart


T = TypeVar("T", bound="EventMessagePartUpdatedProperties")


@_attrs_define
class EventMessagePartUpdatedProperties:
    """
    Attributes:
        part (Union['AgentPart', 'FilePart', 'PatchPart', 'ReasoningPart', 'SnapshotPart', 'StepFinishPart',
            'StepStartPart', 'TextPart', 'ToolPart']):
    """

    part: Union[
        "AgentPart",
        "FilePart",
        "PatchPart",
        "ReasoningPart",
        "SnapshotPart",
        "StepFinishPart",
        "StepStartPart",
        "TextPart",
        "ToolPart",
    ]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.file_part import FilePart
        from ..models.patch_part import PatchPart
        from ..models.reasoning_part import ReasoningPart
        from ..models.snapshot_part import SnapshotPart
        from ..models.step_finish_part import StepFinishPart
        from ..models.step_start_part import StepStartPart
        from ..models.text_part import TextPart
        from ..models.tool_part import ToolPart

        part: dict[str, Any]
        if isinstance(self.part, TextPart):
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
        else:
            part = self.part.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "part": part,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_part import AgentPart
        from ..models.file_part import FilePart
        from ..models.patch_part import PatchPart
        from ..models.reasoning_part import ReasoningPart
        from ..models.snapshot_part import SnapshotPart
        from ..models.step_finish_part import StepFinishPart
        from ..models.step_start_part import StepStartPart
        from ..models.text_part import TextPart
        from ..models.tool_part import ToolPart

        d = dict(src_dict)

        def _parse_part(
            data: object,
        ) -> Union[
            "AgentPart",
            "FilePart",
            "PatchPart",
            "ReasoningPart",
            "SnapshotPart",
            "StepFinishPart",
            "StepStartPart",
            "TextPart",
            "ToolPart",
        ]:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_0 = TextPart.from_dict(data)

                return componentsschemas_part_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_1 = ReasoningPart.from_dict(data)

                return componentsschemas_part_type_1
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_2 = FilePart.from_dict(data)

                return componentsschemas_part_type_2
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_3 = ToolPart.from_dict(data)

                return componentsschemas_part_type_3
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_4 = StepStartPart.from_dict(data)

                return componentsschemas_part_type_4
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_5 = StepFinishPart.from_dict(data)

                return componentsschemas_part_type_5
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_6 = SnapshotPart.from_dict(data)

                return componentsschemas_part_type_6
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_7 = PatchPart.from_dict(data)

                return componentsschemas_part_type_7
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_part_type_8 = AgentPart.from_dict(data)

            return componentsschemas_part_type_8

        part = _parse_part(d.pop("part"))

        event_message_part_updated_properties = cls(
            part=part,
        )

        event_message_part_updated_properties.additional_properties = d
        return event_message_part_updated_properties

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
