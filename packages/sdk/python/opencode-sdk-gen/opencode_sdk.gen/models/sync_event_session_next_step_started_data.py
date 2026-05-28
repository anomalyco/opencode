from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.sync_event_session_next_step_started_data_model import SyncEventSessionNextStepStartedDataModel


T = TypeVar("T", bound="SyncEventSessionNextStepStartedData")


@_attrs_define
class SyncEventSessionNextStepStartedData:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        agent (str):
        model (SyncEventSessionNextStepStartedDataModel):
        snapshot (str | Unset):
    """

    timestamp: float
    session_id: str
    agent: str
    model: SyncEventSessionNextStepStartedDataModel
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
        from ..models.sync_event_session_next_step_started_data_model import SyncEventSessionNextStepStartedDataModel

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        agent = d.pop("agent")

        model = SyncEventSessionNextStepStartedDataModel.from_dict(d.pop("model"))

        snapshot = d.pop("snapshot", UNSET)

        sync_event_session_next_step_started_data = cls(
            timestamp=timestamp,
            session_id=session_id,
            agent=agent,
            model=model,
            snapshot=snapshot,
        )

        return sync_event_session_next_step_started_data
