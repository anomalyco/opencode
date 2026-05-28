from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.session import Session


T = TypeVar("T", bound="SyncEventSessionDeletedData")


@_attrs_define
class SyncEventSessionDeletedData:
    """
    Attributes:
        session_id (str):
        info (Session):
    """

    session_id: str
    info: Session

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
        from ..models.session import Session

        d = dict(src_dict)
        session_id = d.pop("sessionID")

        info = Session.from_dict(d.pop("info"))

        sync_event_session_deleted_data = cls(
            session_id=session_id,
            info=info,
        )

        return sync_event_session_deleted_data
