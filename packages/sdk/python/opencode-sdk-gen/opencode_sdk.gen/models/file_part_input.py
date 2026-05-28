from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.file_part_input_type import FilePartInputType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.file_source import FileSource
    from ..models.resource_source import ResourceSource
    from ..models.symbol_source import SymbolSource


T = TypeVar("T", bound="FilePartInput")


@_attrs_define
class FilePartInput:
    """
    Attributes:
        type_ (FilePartInputType):
        mime (str):
        url (str):
        id (str | Unset):
        filename (str | Unset):
        source (FileSource | ResourceSource | SymbolSource | Unset):
    """

    type_: FilePartInputType
    mime: str
    url: str
    id: str | Unset = UNSET
    filename: str | Unset = UNSET
    source: FileSource | ResourceSource | SymbolSource | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.file_source import FileSource
        from ..models.symbol_source import SymbolSource

        type_ = self.type_.value

        mime = self.mime

        url = self.url

        id = self.id

        filename = self.filename

        source: dict[str, Any] | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        elif isinstance(self.source, FileSource):
            source = self.source.to_dict()
        elif isinstance(self.source, SymbolSource):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "mime": mime,
                "url": url,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if filename is not UNSET:
            field_dict["filename"] = filename
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_source import FileSource
        from ..models.resource_source import ResourceSource
        from ..models.symbol_source import SymbolSource

        d = dict(src_dict)
        type_ = FilePartInputType(d.pop("type"))

        mime = d.pop("mime")

        url = d.pop("url")

        id = d.pop("id", UNSET)

        filename = d.pop("filename", UNSET)

        def _parse_source(data: object) -> FileSource | ResourceSource | SymbolSource | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_file_part_source_type_0 = FileSource.from_dict(data)

                return componentsschemas_file_part_source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_file_part_source_type_1 = SymbolSource.from_dict(data)

                return componentsschemas_file_part_source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_file_part_source_type_2 = ResourceSource.from_dict(data)

            return componentsschemas_file_part_source_type_2

        source = _parse_source(d.pop("source", UNSET))

        file_part_input = cls(
            type_=type_,
            mime=mime,
            url=url,
            id=id,
            filename=filename,
            source=source,
        )

        return file_part_input
