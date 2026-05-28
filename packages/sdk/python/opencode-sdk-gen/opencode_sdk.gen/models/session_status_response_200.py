from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.session_status_type_0 import SessionStatusType0
    from ..models.session_status_type_1 import SessionStatusType1
    from ..models.session_status_type_2 import SessionStatusType2


T = TypeVar("T", bound="SessionStatusResponse200")


@_attrs_define
class SessionStatusResponse200:
    """Get session status"""

    additional_properties: dict[str, SessionStatusType0 | SessionStatusType1 | SessionStatusType2] = _attrs_field(
        init=False, factory=dict
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.session_status_type_0 import SessionStatusType0
        from ..models.session_status_type_1 import SessionStatusType1

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, SessionStatusType0):
                field_dict[prop_name] = prop.to_dict()
            elif isinstance(prop, SessionStatusType1):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_status_type_0 import SessionStatusType0
        from ..models.session_status_type_1 import SessionStatusType1
        from ..models.session_status_type_2 import SessionStatusType2

        d = dict(src_dict)
        session_status_response_200 = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> SessionStatusType0 | SessionStatusType1 | SessionStatusType2:
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

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        session_status_response_200.additional_properties = additional_properties
        return session_status_response_200

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> SessionStatusType0 | SessionStatusType1 | SessionStatusType2:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: SessionStatusType0 | SessionStatusType1 | SessionStatusType2) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
