from collections.abc import Mapping
from typing import Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="EventFileWatcherUpdatedProperties")


@_attrs_define
class EventFileWatcherUpdatedProperties:
    """
    Attributes:
        file (str):
        event (Union[Literal['add'], Literal['change'], Literal['unlink']]):
    """

    file: str
    event: Union[Literal["add"], Literal["change"], Literal["unlink"]]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        event: Union[Literal["add"], Literal["change"], Literal["unlink"]]
        event = self.event

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "file": file,
                "event": event,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = d.pop("file")

        def _parse_event(data: object) -> Union[Literal["add"], Literal["change"], Literal["unlink"]]:
            event_type_0 = cast(Literal["add"], data)
            if event_type_0 != "add":
                raise ValueError(f"event_type_0 must match const 'add', got '{event_type_0}'")
            return event_type_0
            event_type_1 = cast(Literal["change"], data)
            if event_type_1 != "change":
                raise ValueError(f"event_type_1 must match const 'change', got '{event_type_1}'")
            return event_type_1
            event_type_2 = cast(Literal["unlink"], data)
            if event_type_2 != "unlink":
                raise ValueError(f"event_type_2 must match const 'unlink', got '{event_type_2}'")
            return event_type_2

        event = _parse_event(d.pop("event"))

        event_file_watcher_updated_properties = cls(
            file=file,
            event=event,
        )

        event_file_watcher_updated_properties.additional_properties = d
        return event_file_watcher_updated_properties

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
