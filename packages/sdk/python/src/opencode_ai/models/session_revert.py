from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionRevert")


@_attrs_define
class SessionRevert:
    """
    Attributes:
        message_id (str):
        part_id (Union[Unset, str]):
        snapshot (Union[Unset, str]):
        diff (Union[Unset, str]):
    """

    message_id: str
    part_id: Union[Unset, str] = UNSET
    snapshot: Union[Unset, str] = UNSET
    diff: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        message_id = self.message_id

        part_id = self.part_id

        snapshot = self.snapshot

        diff = self.diff

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "messageID": message_id,
            }
        )
        if part_id is not UNSET:
            field_dict["partID"] = part_id
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot
        if diff is not UNSET:
            field_dict["diff"] = diff

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message_id = d.pop("messageID")

        part_id = d.pop("partID", UNSET)

        snapshot = d.pop("snapshot", UNSET)

        diff = d.pop("diff", UNSET)

        session_revert = cls(
            message_id=message_id,
            part_id=part_id,
            snapshot=snapshot,
            diff=diff,
        )

        session_revert.additional_properties = d
        return session_revert

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
