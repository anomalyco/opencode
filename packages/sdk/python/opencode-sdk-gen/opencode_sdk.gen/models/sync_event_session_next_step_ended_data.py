from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.sync_event_session_next_step_ended_data_tokens import SyncEventSessionNextStepEndedDataTokens


T = TypeVar("T", bound="SyncEventSessionNextStepEndedData")


@_attrs_define
class SyncEventSessionNextStepEndedData:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        finish (str):
        cost (float):
        tokens (SyncEventSessionNextStepEndedDataTokens):
        snapshot (str | Unset):
    """

    timestamp: float
    session_id: str
    finish: str
    cost: float
    tokens: SyncEventSessionNextStepEndedDataTokens
    snapshot: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        finish = self.finish

        cost = self.cost

        tokens = self.tokens.to_dict()

        snapshot = self.snapshot

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "finish": finish,
                "cost": cost,
                "tokens": tokens,
            }
        )
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.sync_event_session_next_step_ended_data_tokens import SyncEventSessionNextStepEndedDataTokens

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        finish = d.pop("finish")

        cost = d.pop("cost")

        tokens = SyncEventSessionNextStepEndedDataTokens.from_dict(d.pop("tokens"))

        snapshot = d.pop("snapshot", UNSET)

        sync_event_session_next_step_ended_data = cls(
            timestamp=timestamp,
            session_id=session_id,
            finish=finish,
            cost=cost,
            tokens=tokens,
            snapshot=snapshot,
        )

        return sync_event_session_next_step_ended_data
