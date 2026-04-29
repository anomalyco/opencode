from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.json_schema import JSONSchema


T = TypeVar("T", bound="OutputFormatJsonSchema")


@_attrs_define
class OutputFormatJsonSchema:
    """
    Attributes:
        type_ (Literal['json_schema']):
        schema (JSONSchema):
        retry_count (int | Unset):  Default: 2.
    """

    type_: Literal["json_schema"]
    schema: JSONSchema
    retry_count: int | Unset = 2
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.json_schema import JSONSchema

        type_ = self.type_

        schema = self.schema.to_dict()

        retry_count = self.retry_count

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "schema": schema,
            }
        )
        if retry_count is not UNSET:
            field_dict["retryCount"] = retry_count

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.json_schema import JSONSchema

        d = dict(src_dict)
        type_ = cast(Literal["json_schema"], d.pop("type"))
        if type_ != "json_schema":
            raise ValueError(f"type must match const 'json_schema', got '{type_}'")

        schema = JSONSchema.from_dict(d.pop("schema"))

        retry_count = d.pop("retryCount", UNSET)

        output_format_json_schema = cls(
            type_=type_,
            schema=schema,
            retry_count=retry_count,
        )

        output_format_json_schema.additional_properties = d
        return output_format_json_schema

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
