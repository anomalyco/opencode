from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.project_time import ProjectTime


T = TypeVar("T", bound="Project")


@_attrs_define
class Project:
    """
    Attributes:
        id (str):
        worktree (str):
        time (ProjectTime):
        vcs (Union[Literal['git'], Unset]):
    """

    id: str
    worktree: str
    time: "ProjectTime"
    vcs: Union[Literal["git"], Unset] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        worktree = self.worktree

        time = self.time.to_dict()

        vcs = self.vcs

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "worktree": worktree,
                "time": time,
            }
        )
        if vcs is not UNSET:
            field_dict["vcs"] = vcs

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.project_time import ProjectTime

        d = dict(src_dict)
        id = d.pop("id")

        worktree = d.pop("worktree")

        time = ProjectTime.from_dict(d.pop("time"))

        vcs = cast(Union[Literal["git"], Unset], d.pop("vcs", UNSET))
        if vcs != "git" and not isinstance(vcs, Unset):
            raise ValueError(f"vcs must match const 'git', got '{vcs}'")

        project = cls(
            id=id,
            worktree=worktree,
            time=time,
            vcs=vcs,
        )

        project.additional_properties = d
        return project

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
