from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.event_session_next_step_started_properties_model import EventSessionNextStepStartedPropertiesModel


T = TypeVar("T", bound="EventSessionNextStepStartedProperties")


@_attrs_define
class EventSessionNextStepStartedProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        agent (str):
        model (EventSessionNextStepStartedPropertiesModel):
        snapshot (str | Unset):
    """

    timestamp: float
    session_id: str
    agent: str
    model: EventSessionNextStepStartedPropertiesModel
    snapshot: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        agent = self.agent

        model = self.model.to_dict()

        snapshot = self.snapshot

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "agent": agent,
                "model": model,
            }
        )
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_session_next_step_started_properties_model import EventSessionNextStepStartedPropertiesModel

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        agent = d.pop("agent")

        model = EventSessionNextStepStartedPropertiesModel.from_dict(d.pop("model"))

        snapshot = d.pop("snapshot", UNSET)

        event_session_next_step_started_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            agent=agent,
            model=model,
            snapshot=snapshot,
        )

        return event_session_next_step_started_properties
