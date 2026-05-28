from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PtyConnectTokenResponse200")


@_attrs_define
class PtyConnectTokenResponse200:
    """WebSocket connect token

    Attributes:
        ticket (str):
        expires_in (int):
    """

    ticket: str
    expires_in: int

    def to_dict(self) -> dict[str, Any]:
        ticket = self.ticket

        expires_in = self.expires_in

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ticket": ticket,
                "expires_in": expires_in,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ticket = d.pop("ticket")

        expires_in = d.pop("expires_in")

        pty_connect_token_response_200 = cls(
            ticket=ticket,
            expires_in=expires_in,
        )

        return pty_connect_token_response_200
