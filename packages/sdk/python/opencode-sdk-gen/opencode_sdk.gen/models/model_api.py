from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ModelApi")


@_attrs_define
class ModelApi:
    """
    Attributes:
        id (str):
        url (str):
        npm (str):
    """

    id: str
    url: str
    npm: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        url = self.url

        npm = self.npm

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "url": url,
                "npm": npm,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        url = d.pop("url")

        npm = d.pop("npm")

        model_api = cls(
            id=id,
            url=url,
            npm=npm,
        )

        return model_api
