from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.session_message_agent_switched import SessionMessageAgentSwitched
    from ..models.session_message_assistant import SessionMessageAssistant
    from ..models.session_message_compaction import SessionMessageCompaction
    from ..models.session_message_model_switched import SessionMessageModelSwitched
    from ..models.session_message_shell import SessionMessageShell
    from ..models.session_message_synthetic import SessionMessageSynthetic
    from ..models.session_message_user import SessionMessageUser
    from ..models.v2_session_messages_response_cursor import V2SessionMessagesResponseCursor


T = TypeVar("T", bound="V2SessionMessagesResponse")


@_attrs_define
class V2SessionMessagesResponse:
    """
    Attributes:
        items (list[SessionMessageAgentSwitched | SessionMessageAssistant | SessionMessageCompaction |
            SessionMessageModelSwitched | SessionMessageShell | SessionMessageSynthetic | SessionMessageUser]):
        cursor (V2SessionMessagesResponseCursor):
    """

    items: list[
        SessionMessageAgentSwitched
        | SessionMessageAssistant
        | SessionMessageCompaction
        | SessionMessageModelSwitched
        | SessionMessageShell
        | SessionMessageSynthetic
        | SessionMessageUser
    ]
    cursor: V2SessionMessagesResponseCursor

    def to_dict(self) -> dict[str, Any]:
        from ..models.session_message_agent_switched import SessionMessageAgentSwitched
        from ..models.session_message_assistant import SessionMessageAssistant
        from ..models.session_message_model_switched import SessionMessageModelSwitched
        from ..models.session_message_shell import SessionMessageShell
        from ..models.session_message_synthetic import SessionMessageSynthetic
        from ..models.session_message_user import SessionMessageUser

        items = []
        for items_item_data in self.items:
            items_item: dict[str, Any]
            if isinstance(items_item_data, SessionMessageAgentSwitched):
                items_item = items_item_data.to_dict()
            elif isinstance(items_item_data, SessionMessageModelSwitched):
                items_item = items_item_data.to_dict()
            elif isinstance(items_item_data, SessionMessageUser):
                items_item = items_item_data.to_dict()
            elif isinstance(items_item_data, SessionMessageSynthetic):
                items_item = items_item_data.to_dict()
            elif isinstance(items_item_data, SessionMessageShell):
                items_item = items_item_data.to_dict()
            elif isinstance(items_item_data, SessionMessageAssistant):
                items_item = items_item_data.to_dict()
            else:
                items_item = items_item_data.to_dict()

            items.append(items_item)

        cursor = self.cursor.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "items": items,
                "cursor": cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_message_agent_switched import SessionMessageAgentSwitched
        from ..models.session_message_assistant import SessionMessageAssistant
        from ..models.session_message_compaction import SessionMessageCompaction
        from ..models.session_message_model_switched import SessionMessageModelSwitched
        from ..models.session_message_shell import SessionMessageShell
        from ..models.session_message_synthetic import SessionMessageSynthetic
        from ..models.session_message_user import SessionMessageUser
        from ..models.v2_session_messages_response_cursor import V2SessionMessagesResponseCursor

        d = dict(src_dict)
        items = []
        _items = d.pop("items")
        for items_item_data in _items:

            def _parse_items_item(
                data: object,
            ) -> (
                SessionMessageAgentSwitched
                | SessionMessageAssistant
                | SessionMessageCompaction
                | SessionMessageModelSwitched
                | SessionMessageShell
                | SessionMessageSynthetic
                | SessionMessageUser
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_0 = SessionMessageAgentSwitched.from_dict(data)

                    return componentsschemas_session_message_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_1 = SessionMessageModelSwitched.from_dict(data)

                    return componentsschemas_session_message_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_2 = SessionMessageUser.from_dict(data)

                    return componentsschemas_session_message_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_3 = SessionMessageSynthetic.from_dict(data)

                    return componentsschemas_session_message_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_4 = SessionMessageShell.from_dict(data)

                    return componentsschemas_session_message_type_4
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_5 = SessionMessageAssistant.from_dict(data)

                    return componentsschemas_session_message_type_5
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_session_message_type_6 = SessionMessageCompaction.from_dict(data)

                return componentsschemas_session_message_type_6

            items_item = _parse_items_item(items_item_data)

            items.append(items_item)

        cursor = V2SessionMessagesResponseCursor.from_dict(d.pop("cursor"))

        v2_session_messages_response = cls(
            items=items,
            cursor=cursor,
        )

        return v2_session_messages_response
