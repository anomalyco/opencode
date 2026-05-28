from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.sync_event_session_next_model_switched_data_model import SyncEventSessionNextModelSwitchedDataModel


T = TypeVar("T", bound="SyncEventSessionNextModelSwitchedData")


@_attrs_define
class SyncEventSessionNextModelSwitchedData:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        model (SyncEventSessionNextModelSwitchedDataModel):
    """

    timestamp: float
    session_id: str
    model: SyncEventSessionNextModelSwitchedDataModel

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        model = self.model.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "model": model,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.sync_event_session_next_model_switched_data_model import (
            SyncEventSessionNextModelSwitchedDataModel,
        )

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        model = SyncEventSessionNextModelSwitchedDataModel.from_dict(d.pop("model"))

        sync_event_session_next_model_switched_data = cls(
            timestamp=timestamp,
            session_id=session_id,
            model=model,
        )

        return sync_event_session_next_model_switched_data
