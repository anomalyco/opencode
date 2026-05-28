from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.assistant_message import AssistantMessage
    from ..models.user_message import UserMessage


T = TypeVar("T", bound="SyncEventMessageUpdatedData")


@_attrs_define
class SyncEventMessageUpdatedData:
    """
    Attributes:
        session_id (str):
        info (AssistantMessage | UserMessage):
    """

    session_id: str
    info: AssistantMessage | UserMessage

    def to_dict(self) -> dict[str, Any]:
        from ..models.user_message import UserMessage

        session_id = self.session_id

        info: dict[str, Any]
        if isinstance(self.info, UserMessage):
            info = self.info.to_dict()
        else:
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

        sync_event_message_updated_data = cls(
            session_id=session_id,
            info=info,
        )

        return sync_event_message_updated_data
