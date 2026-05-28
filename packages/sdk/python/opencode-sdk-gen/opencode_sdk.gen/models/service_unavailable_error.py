from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.service_unavailable_error_tag import ServiceUnavailableErrorTag
from ..types import UNSET, Unset

T = TypeVar("T", bound="ServiceUnavailableError")


@_attrs_define
class ServiceUnavailableError:
    """
    Attributes:
        field_tag (ServiceUnavailableErrorTag):
        message (str):
        service (str | Unset):
    """

    field_tag: ServiceUnavailableErrorTag
    message: str
    service: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        field_tag = self.field_tag.value

        message = self.message

        service = self.service

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "_tag": field_tag,
                "message": message,
            }
        )
        if service is not UNSET:
            field_dict["service"] = service

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_tag = ServiceUnavailableErrorTag(d.pop("_tag"))

        message = d.pop("message")

        service = d.pop("service", UNSET)

        service_unavailable_error = cls(
            field_tag=field_tag,
            message=message,
            service=service,
        )

        return service_unavailable_error
