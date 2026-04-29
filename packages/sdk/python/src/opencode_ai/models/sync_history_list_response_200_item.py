from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.sync_history_list_response_200_item_data import SyncHistoryListResponse200ItemData


T = TypeVar("T", bound="SyncHistoryListResponse200Item")


@_attrs_define
class SyncHistoryListResponse200Item:
    """
    Attributes:
        id (str):
        aggregate_id (str):
        seq (float):
        type_ (str):
        data (SyncHistoryListResponse200ItemData):
    """

    id: str
    aggregate_id: str
    seq: float
    type_: str
    data: SyncHistoryListResponse200ItemData
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.sync_history_list_response_200_item_data import SyncHistoryListResponse200ItemData

        id = self.id

        aggregate_id = self.aggregate_id

        seq = self.seq

        type_ = self.type_

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "aggregate_id": aggregate_id,
                "seq": seq,
                "type": type_,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.sync_history_list_response_200_item_data import SyncHistoryListResponse200ItemData

        d = dict(src_dict)
        id = d.pop("id")

        aggregate_id = d.pop("aggregate_id")

        seq = d.pop("seq")

        type_ = d.pop("type")

        data = SyncHistoryListResponse200ItemData.from_dict(d.pop("data"))

        sync_history_list_response_200_item = cls(
            id=id,
            aggregate_id=aggregate_id,
            seq=seq,
            type_=type_,
            data=data,
        )

        sync_history_list_response_200_item.additional_properties = d
        return sync_history_list_response_200_item

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
