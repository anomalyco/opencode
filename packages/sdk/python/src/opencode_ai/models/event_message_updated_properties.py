from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.assistant_message import AssistantMessage
    from ..models.user_message import UserMessage


T = TypeVar("T", bound="EventMessageUpdatedProperties")


@_attrs_define
class EventMessageUpdatedProperties:
    """
    Attributes:
        session_id (str):
        info (AssistantMessage | UserMessage):
    """

    session_id: str
    info: AssistantMessage | UserMessage
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.assistant_message import AssistantMessage
        from ..models.user_message import UserMessage

        session_id = self.session_id

        info: dict[str, Any]
        if isinstance(self.info, UserMessage):
            info = self.info.to_dict()
        else:
            info = self.info.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionID": session_id,
                "info": info,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.assistant_message import AssistantMessage
        from ..models.user_message import UserMessage

        d = dict(src_dict)
        session_id = d.pop("sessionID")

        def _parse_info(data: object) -> AssistantMessage | UserMessage:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_message_type_0 = UserMessage.from_dict(data)

                return componentsschemas_message_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_message_type_1 = AssistantMessage.from_dict(data)

            return componentsschemas_message_type_1

        info = _parse_info(d.pop("info"))

        event_message_updated_properties = cls(
            session_id=session_id,
            info=info,
        )

        event_message_updated_properties.additional_properties = d
        return event_message_updated_properties

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
