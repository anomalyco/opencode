from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_revert import SessionRevert
    from ..models.session_share import SessionShare
    from ..models.session_time import SessionTime


T = TypeVar("T", bound="Session")


@_attrs_define
class Session:
    """
    Attributes:
        id (str):
        project_id (str):
        directory (str):
        title (str):
        version (str):
        time (SessionTime):
        parent_id (Union[Unset, str]):
        share (Union[Unset, SessionShare]):
        revert (Union[Unset, SessionRevert]):
    """

    id: str
    project_id: str
    directory: str
    title: str
    version: str
    time: "SessionTime"
    parent_id: Union[Unset, str] = UNSET
    share: Union[Unset, "SessionShare"] = UNSET
    revert: Union[Unset, "SessionRevert"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        project_id = self.project_id

        directory = self.directory

        title = self.title

        version = self.version

        time = self.time.to_dict()

        parent_id = self.parent_id

        share: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.share, Unset):
            share = self.share.to_dict()

        revert: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.revert, Unset):
            revert = self.revert.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "projectID": project_id,
                "directory": directory,
                "title": title,
                "version": version,
                "time": time,
            }
        )
        if parent_id is not UNSET:
            field_dict["parentID"] = parent_id
        if share is not UNSET:
            field_dict["share"] = share
        if revert is not UNSET:
            field_dict["revert"] = revert

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_revert import SessionRevert
        from ..models.session_share import SessionShare
        from ..models.session_time import SessionTime

        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectID")

        directory = d.pop("directory")

        title = d.pop("title")

        version = d.pop("version")

        time = SessionTime.from_dict(d.pop("time"))

        parent_id = d.pop("parentID", UNSET)

        _share = d.pop("share", UNSET)
        share: Union[Unset, SessionShare]
        if isinstance(_share, Unset):
            share = UNSET
        else:
            share = SessionShare.from_dict(_share)

        _revert = d.pop("revert", UNSET)
        revert: Union[Unset, SessionRevert]
        if isinstance(_revert, Unset):
            revert = UNSET
        else:
            revert = SessionRevert.from_dict(_revert)

        session = cls(
            id=id,
            project_id=project_id,
            directory=directory,
            title=title,
            version=version,
            time=time,
            parent_id=parent_id,
            share=share,
            revert=revert,
        )

        session.additional_properties = d
        return session

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
