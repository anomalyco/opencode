from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.vcs_apply_error_name import VcsApplyErrorName

if TYPE_CHECKING:
    from ..models.vcs_apply_error_data import VcsApplyErrorData


T = TypeVar("T", bound="VcsApplyError")


@_attrs_define
class VcsApplyError:
    """
    Attributes:
        name (VcsApplyErrorName):
        data (VcsApplyErrorData):
    """

    name: VcsApplyErrorName
    data: VcsApplyErrorData

    def to_dict(self) -> dict[str, Any]:
        name = self.name.value

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.vcs_apply_error_data import VcsApplyErrorData

        d = dict(src_dict)
        name = VcsApplyErrorName(d.pop("name"))

        data = VcsApplyErrorData.from_dict(d.pop("data"))

        vcs_apply_error = cls(
            name=name,
            data=data,
        )

        return vcs_apply_error
