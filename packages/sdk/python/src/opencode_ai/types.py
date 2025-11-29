"""Contains some shared types for properties"""

from collections.abc import Mapping, MutableMapping
from http import HTTPStatus
from typing import IO, BinaryIO, Generic, Literal, Optional, TypeVar, Union

from attrs import define


class Unset:
    def __bool__(self) -> Literal[False]:
        return False


UNSET: Unset = Unset()

# The types that `httpx.Client(files=)` can accept, copied from that library.
FileContent = Union[IO[bytes], bytes, str]
FileTypes = Union[
    # (filename, file (or bytes), content_type)
    tuple[Optional[str], FileContent, Optional[str]],
    # (filename, file (or bytes), content_type, headers)
    tuple[Optional[str], FileContent, Optional[str], Mapping[str, str]],
]
RequestFiles = list[tuple[str, FileTypes]]


@define
class File:
    """Contains information for file uploads"""

    payload: BinaryIO
    file_name: Optional[str] = None
    mime_type: Optional[str] = None

    def to_tuple(self) -> FileTypes:
        """Return a tuple representation that httpx will accept for multipart/form-data"""
        return self.file_name, self.payload, self.mime_type


T = TypeVar("T")


@define
class Response(Generic[T]):
    """A response from an endpoint"""

    status_code: HTTPStatus
    content: bytes
    headers: MutableMapping[str, str]
    parsed: Optional[T]


__all__ = ["UNSET", "File", "FileTypes", "RequestFiles", "Response", "Unset"]
