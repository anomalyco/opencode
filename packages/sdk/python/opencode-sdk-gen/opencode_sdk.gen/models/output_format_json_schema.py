from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.output_format_json_schema_type import OutputFormatJsonSchemaType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.json_schema import JSONSchema


T = TypeVar("T", bound="OutputFormatJsonSchema")


@_attrs_define
class OutputFormatJsonSchema:
    """
    Attributes:
        type_ (OutputFormatJsonSchemaType):
        schema (JSONSchema):
        retry_count (int | Unset):
    """

    type_: OutputFormatJsonSchemaType
    schema: JSONSchema
    retry_count: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        schema = self.schema.to_dict()

        retry_count = self.retry_count

        field_dict: dict[str, Any] = {}

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
        type_ = OutputFormatJsonSchemaType(d.pop("type"))

        schema = JSONSchema.from_dict(d.pop("schema"))

        retry_count = d.pop("retryCount", UNSET)

        output_format_json_schema = cls(
            type_=type_,
            schema=schema,
            retry_count=retry_count,
        )

        return output_format_json_schema
