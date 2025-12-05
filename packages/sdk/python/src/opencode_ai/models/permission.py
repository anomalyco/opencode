from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.permission_metadata import PermissionMetadata
    from ..models.permission_time import PermissionTime


T = TypeVar("T", bound="Permission")


@_attrs_define
class Permission:
    """
    Attributes:
        id (str):
        type_ (str):
        session_id (str):
        message_id (str):
        title (str):
        metadata (PermissionMetadata):
        time (PermissionTime):
        pattern (Union[Unset, list[str], str]):
        call_id (Union[Unset, str]):
    """

    id: str
    type_: str
    session_id: str
    message_id: str
    title: str
    metadata: "PermissionMetadata"
    time: "PermissionTime"
    pattern: Union[Unset, list[str], str] = UNSET
    call_id: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        session_id = self.session_id

        message_id = self.message_id

        title = self.title

        metadata = self.metadata.to_dict()

        time = self.time.to_dict()

        pattern: Union[Unset, list[str], str]
        if isinstance(self.pattern, Unset):
            pattern = UNSET
        elif isinstance(self.pattern, list):
            pattern = self.pattern

        else:
            pattern = self.pattern

        call_id = self.call_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "type": type_,
                "sessionID": session_id,
                "messageID": message_id,
                "title": title,
                "metadata": metadata,
                "time": time,
            }
        )
        if pattern is not UNSET:
            field_dict["pattern"] = pattern
        if call_id is not UNSET:
            field_dict["callID"] = call_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_metadata import PermissionMetadata
        from ..models.permission_time import PermissionTime

        d = dict(src_dict)
        id = d.pop("id")

        type_ = d.pop("type")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        title = d.pop("title")

        metadata = PermissionMetadata.from_dict(d.pop("metadata"))

        time = PermissionTime.from_dict(d.pop("time"))

        def _parse_pattern(data: object) -> Union[Unset, list[str], str]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                pattern_type_1 = cast(list[str], data)

                return pattern_type_1
            except:  # noqa: E722
                pass
            return cast(Union[Unset, list[str], str], data)

        pattern = _parse_pattern(d.pop("pattern", UNSET))

        call_id = d.pop("callID", UNSET)

        permission = cls(
            id=id,
            type_=type_,
            session_id=session_id,
            message_id=message_id,
            title=title,
            metadata=metadata,
            time=time,
            pattern=pattern,
            call_id=call_id,
        )

        permission.additional_properties = d
        return permission

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
