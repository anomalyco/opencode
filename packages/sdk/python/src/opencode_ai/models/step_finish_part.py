from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        type_ (Literal['step-finish']):
        cost (float):
        tokens (StepFinishPartTokens):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["step-finish"]
    cost: float
    tokens: "StepFinishPartTokens"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        cost = self.cost

        tokens = self.tokens.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "cost": cost,
                "tokens": tokens,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.step_finish_part_tokens import StepFinishPartTokens

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = cast(Literal["step-finish"], d.pop("type"))
        if type_ != "step-finish":
            raise ValueError(f"type must match const 'step-finish', got '{type_}'")

        cost = d.pop("cost")

        tokens = StepFinishPartTokens.from_dict(d.pop("tokens"))

        step_finish_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            cost=cost,
            tokens=tokens,
        )

        step_finish_part.additional_properties = d
        return step_finish_part

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
