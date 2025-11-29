from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.assistant_message import AssistantMessage
    from ..models.user_message import UserMessage


T = TypeVar("T", bound="EventMessageUpdatedProperties")


@_attrs_define
class EventMessageUpdatedProperties:
    """
    Attributes:
        info (Union['AssistantMessage', 'UserMessage']):
    """

    info: Union["AssistantMessage", "UserMessage"]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.user_message import UserMessage

        info: dict[str, Any]
        if isinstance(self.info, UserMessage):
            info = self.info.to_dict()
        else:
            info = self.info.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "info": info,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.assistant_message import AssistantMessage
        from ..models.user_message import UserMessage

        d = dict(src_dict)

        def _parse_info(data: object) -> Union["AssistantMessage", "UserMessage"]:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_message_type_0 = UserMessage.from_dict(data)

                return componentsschemas_message_type_0
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_message_type_1 = AssistantMessage.from_dict(data)

            return componentsschemas_message_type_1

        info = _parse_info(d.pop("info"))

        event_message_updated_properties = cls(
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
