from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.vcs_apply_error_data_reason import VcsApplyErrorDataReason

T = TypeVar("T", bound="VcsApplyErrorData")


@_attrs_define
class VcsApplyErrorData:
    """
    Attributes:
        message (str):
        reason (VcsApplyErrorDataReason):
    """

    message: str
    reason: VcsApplyErrorDataReason

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        reason = self.reason.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        reason = VcsApplyErrorDataReason(d.pop("reason"))

        vcs_apply_error_data = cls(
            message=message,
            reason=reason,
        )

        return vcs_apply_error_data
