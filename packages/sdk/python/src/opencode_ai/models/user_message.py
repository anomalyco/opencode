from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.user_message_time import UserMessageTime


T = TypeVar("T", bound="UserMessage")


@_attrs_define
class UserMessage:
    """
    Attributes:
        id (str):
        session_id (str):
        role (Literal['user']):
        time (UserMessageTime):
    """

    id: str
    session_id: str
    role: Literal["user"]
    time: "UserMessageTime"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        role = self.role

        time = self.time.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "role": role,
                "time": time,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.user_message_time import UserMessageTime

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        role = cast(Literal["user"], d.pop("role"))
        if role != "user":
            raise ValueError(f"role must match const 'user', got '{role}'")

        time = UserMessageTime.from_dict(d.pop("time"))

        user_message = cls(
            id=id,
            session_id=session_id,
            role=role,
            time=time,
        )

        user_message.additional_properties = d
        return user_message

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
