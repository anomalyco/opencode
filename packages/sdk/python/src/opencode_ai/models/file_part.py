from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.file_source import FileSource
    from ..models.symbol_source import SymbolSource


T = TypeVar("T", bound="FilePart")


@_attrs_define
class FilePart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (Literal['file']):
        mime (str):
        url (str):
        filename (Union[Unset, str]):
        source (Union['FileSource', 'SymbolSource', Unset]):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["file"]
    mime: str
    url: str
    filename: Union[Unset, str] = UNSET
    source: Union["FileSource", "SymbolSource", Unset] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.file_source import FileSource

        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        mime = self.mime

        url = self.url

        filename = self.filename

        source: Union[Unset, dict[str, Any]]
        if isinstance(self.source, Unset):
            source = UNSET
        elif isinstance(self.source, FileSource):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "mime": mime,
                "url": url,
            }
        )
        if filename is not UNSET:
            field_dict["filename"] = filename
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_source import FileSource
        from ..models.symbol_source import SymbolSource

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = cast(Literal["file"], d.pop("type"))
        if type_ != "file":
            raise ValueError(f"type must match const 'file', got '{type_}'")

        mime = d.pop("mime")

        url = d.pop("url")

        filename = d.pop("filename", UNSET)

        def _parse_source(data: object) -> Union["FileSource", "SymbolSource", Unset]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_file_part_source_type_0 = FileSource.from_dict(data)

                return componentsschemas_file_part_source_type_0
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_file_part_source_type_1 = SymbolSource.from_dict(data)

            return componentsschemas_file_part_source_type_1

        source = _parse_source(d.pop("source", UNSET))

        file_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            mime=mime,
            url=url,
            filename=filename,
            source=source,
        )

        file_part.additional_properties = d
        return file_part

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
