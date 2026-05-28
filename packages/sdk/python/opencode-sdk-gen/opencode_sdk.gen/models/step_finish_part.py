from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.step_finish_part_type import StepFinishPartType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.step_finish_part_tokens import StepFinishPartTokens


T = TypeVar("T", bound="StepFinishPart")


@_attrs_define
class StepFinishPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (StepFinishPartType):
        reason (str):
        cost (float):
        tokens (StepFinishPartTokens):
        snapshot (str | Unset):
    """

    id: str
    session_id: str
    message_id: str
    type_: StepFinishPartType
    reason: str
    cost: float
    tokens: StepFinishPartTokens
    snapshot: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        reason = self.reason

        cost = self.cost

        tokens = self.tokens.to_dict()

        snapshot = self.snapshot

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "reason": reason,
                "cost": cost,
                "tokens": tokens,
            }
        )
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.step_finish_part_tokens import StepFinishPartTokens

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = StepFinishPartType(d.pop("type"))

        reason = d.pop("reason")

        cost = d.pop("cost")

        tokens = StepFinishPartTokens.from_dict(d.pop("tokens"))

        snapshot = d.pop("snapshot", UNSET)

        step_finish_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            reason=reason,
            cost=cost,
            tokens=tokens,
            snapshot=snapshot,
        )

        return step_finish_part
