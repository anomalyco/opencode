from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_status_type_0 import SessionStatusType0
    from ..models.session_status_type_1 import SessionStatusType1
    from ..models.session_status_type_2 import SessionStatusType2


T = TypeVar("T", bound="EventSessionStatusProperties")


@_attrs_define
class EventSessionStatusProperties:
    """
    Attributes:
        session_id (str):
        status (SessionStatusType0 | SessionStatusType1 | SessionStatusType2):
    """

    session_id: str
    status: SessionStatusType0 | SessionStatusType1 | SessionStatusType2
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.session_status_type_0 import SessionStatusType0
        from ..models.session_status_type_1 import SessionStatusType1
        from ..models.session_status_type_2 import SessionStatusType2

        session_id = self.session_id

        status: dict[str, Any]
        if isinstance(self.status, SessionStatusType0):
            status = self.status.to_dict()
        elif isinstance(self.status, SessionStatusType1):
            status = self.status.to_dict()
        else:
            status = self.status.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionID": session_id,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_status_type_0 import SessionStatusType0
        from ..models.session_status_type_1 import SessionStatusType1
        from ..models.session_status_type_2 import SessionStatusType2

        d = dict(src_dict)
        session_id = d.pop("sessionID")

        def _parse_status(data: object) -> SessionStatusType0 | SessionStatusType1 | SessionStatusType2:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_session_status_type_0 = SessionStatusType0.from_dict(data)

                return componentsschemas_session_status_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_session_status_type_1 = SessionStatusType1.from_dict(data)

                return componentsschemas_session_status_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_session_status_type_2 = SessionStatusType2.from_dict(data)

            return componentsschemas_session_status_type_2

        status = _parse_status(d.pop("status"))

        event_session_status_properties = cls(
            session_id=session_id,
            status=status,
        )

        event_session_status_properties.additional_properties = d
        return event_session_status_properties

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
