from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.sync_event_session_updated_data_info import SyncEventSessionUpdatedDataInfo


T = TypeVar("T", bound="SyncEventSessionUpdatedData")


@_attrs_define
class SyncEventSessionUpdatedData:
    """
    Attributes:
        session_id (str):
        info (SyncEventSessionUpdatedDataInfo):
    """

    session_id: str
    info: SyncEventSessionUpdatedDataInfo

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        info = self.info.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionID": session_id,
                "info": info,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.sync_event_session_updated_data_info import SyncEventSessionUpdatedDataInfo

        d = dict(src_dict)
        session_id = d.pop("sessionID")

        info = SyncEventSessionUpdatedDataInfo.from_dict(d.pop("info"))

        sync_event_session_updated_data = cls(
            session_id=session_id,
            info=info,
        )

        return sync_event_session_updated_data
