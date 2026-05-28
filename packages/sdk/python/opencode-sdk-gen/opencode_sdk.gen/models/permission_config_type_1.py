from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.permission_action_config import PermissionActionConfig
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.permission_object_config import PermissionObjectConfig


T = TypeVar("T", bound="PermissionConfigType1")


@_attrs_define
class PermissionConfigType1:
    """
    Attributes:
        read (PermissionActionConfig | PermissionObjectConfig | Unset):
        edit (PermissionActionConfig | PermissionObjectConfig | Unset):
        glob (PermissionActionConfig | PermissionObjectConfig | Unset):
        grep (PermissionActionConfig | PermissionObjectConfig | Unset):
        list_ (PermissionActionConfig | PermissionObjectConfig | Unset):
        bash (PermissionActionConfig | PermissionObjectConfig | Unset):
        task (PermissionActionConfig | PermissionObjectConfig | Unset):
        external_directory (PermissionActionConfig | PermissionObjectConfig | Unset):
        todowrite (PermissionActionConfig | Unset):
        question (PermissionActionConfig | Unset):
        webfetch (PermissionActionConfig | Unset):
        websearch (PermissionActionConfig | Unset):
        repo_clone (PermissionActionConfig | PermissionObjectConfig | Unset):
        repo_overview (PermissionActionConfig | PermissionObjectConfig | Unset):
        lsp (PermissionActionConfig | PermissionObjectConfig | Unset):
        doom_loop (PermissionActionConfig | Unset):
        skill (PermissionActionConfig | PermissionObjectConfig | Unset):
    """

    read: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    edit: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    glob: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    grep: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    list_: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    bash: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    task: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    external_directory: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    todowrite: PermissionActionConfig | Unset = UNSET
    question: PermissionActionConfig | Unset = UNSET
    webfetch: PermissionActionConfig | Unset = UNSET
    websearch: PermissionActionConfig | Unset = UNSET
    repo_clone: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    repo_overview: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    lsp: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    doom_loop: PermissionActionConfig | Unset = UNSET
    skill: PermissionActionConfig | PermissionObjectConfig | Unset = UNSET
    additional_properties: dict[str, PermissionActionConfig | PermissionObjectConfig] = _attrs_field(
        init=False, factory=dict
    )

    def to_dict(self) -> dict[str, Any]:
        read: dict[str, Any] | str | Unset
        if isinstance(self.read, Unset):
            read = UNSET
        elif isinstance(self.read, PermissionActionConfig):
            read = self.read.value
        else:
            read = self.read.to_dict()

        edit: dict[str, Any] | str | Unset
        if isinstance(self.edit, Unset):
            edit = UNSET
        elif isinstance(self.edit, PermissionActionConfig):
            edit = self.edit.value
        else:
            edit = self.edit.to_dict()

        glob: dict[str, Any] | str | Unset
        if isinstance(self.glob, Unset):
            glob = UNSET
        elif isinstance(self.glob, PermissionActionConfig):
            glob = self.glob.value
        else:
            glob = self.glob.to_dict()

        grep: dict[str, Any] | str | Unset
        if isinstance(self.grep, Unset):
            grep = UNSET
        elif isinstance(self.grep, PermissionActionConfig):
            grep = self.grep.value
        else:
            grep = self.grep.to_dict()

        list_: dict[str, Any] | str | Unset
        if isinstance(self.list_, Unset):
            list_ = UNSET
        elif isinstance(self.list_, PermissionActionConfig):
            list_ = self.list_.value
        else:
            list_ = self.list_.to_dict()

        bash: dict[str, Any] | str | Unset
        if isinstance(self.bash, Unset):
            bash = UNSET
        elif isinstance(self.bash, PermissionActionConfig):
            bash = self.bash.value
        else:
            bash = self.bash.to_dict()

        task: dict[str, Any] | str | Unset
        if isinstance(self.task, Unset):
            task = UNSET
        elif isinstance(self.task, PermissionActionConfig):
            task = self.task.value
        else:
            task = self.task.to_dict()

        external_directory: dict[str, Any] | str | Unset
        if isinstance(self.external_directory, Unset):
            external_directory = UNSET
        elif isinstance(self.external_directory, PermissionActionConfig):
            external_directory = self.external_directory.value
        else:
            external_directory = self.external_directory.to_dict()

        todowrite: str | Unset = UNSET
        if not isinstance(self.todowrite, Unset):
            todowrite = self.todowrite.value

        question: str | Unset = UNSET
        if not isinstance(self.question, Unset):
            question = self.question.value

        webfetch: str | Unset = UNSET
        if not isinstance(self.webfetch, Unset):
            webfetch = self.webfetch.value

        websearch: str | Unset = UNSET
        if not isinstance(self.websearch, Unset):
            websearch = self.websearch.value

        repo_clone: dict[str, Any] | str | Unset
        if isinstance(self.repo_clone, Unset):
            repo_clone = UNSET
        elif isinstance(self.repo_clone, PermissionActionConfig):
            repo_clone = self.repo_clone.value
        else:
            repo_clone = self.repo_clone.to_dict()

        repo_overview: dict[str, Any] | str | Unset
        if isinstance(self.repo_overview, Unset):
            repo_overview = UNSET
        elif isinstance(self.repo_overview, PermissionActionConfig):
            repo_overview = self.repo_overview.value
        else:
            repo_overview = self.repo_overview.to_dict()

        lsp: dict[str, Any] | str | Unset
        if isinstance(self.lsp, Unset):
            lsp = UNSET
        elif isinstance(self.lsp, PermissionActionConfig):
            lsp = self.lsp.value
        else:
            lsp = self.lsp.to_dict()

        doom_loop: str | Unset = UNSET
        if not isinstance(self.doom_loop, Unset):
            doom_loop = self.doom_loop.value

        skill: dict[str, Any] | str | Unset
        if isinstance(self.skill, Unset):
            skill = UNSET
        elif isinstance(self.skill, PermissionActionConfig):
            skill = self.skill.value
        else:
            skill = self.skill.to_dict()

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, PermissionActionConfig):
                field_dict[prop_name] = prop.value
            else:
                field_dict[prop_name] = prop.to_dict()

        field_dict.update({})
        if read is not UNSET:
            field_dict["read"] = read
        if edit is not UNSET:
            field_dict["edit"] = edit
        if glob is not UNSET:
            field_dict["glob"] = glob
        if grep is not UNSET:
            field_dict["grep"] = grep
        if list_ is not UNSET:
            field_dict["list"] = list_
        if bash is not UNSET:
            field_dict["bash"] = bash
        if task is not UNSET:
            field_dict["task"] = task
        if external_directory is not UNSET:
            field_dict["external_directory"] = external_directory
        if todowrite is not UNSET:
            field_dict["todowrite"] = todowrite
        if question is not UNSET:
            field_dict["question"] = question
        if webfetch is not UNSET:
            field_dict["webfetch"] = webfetch
        if websearch is not UNSET:
            field_dict["websearch"] = websearch
        if repo_clone is not UNSET:
            field_dict["repo_clone"] = repo_clone
        if repo_overview is not UNSET:
            field_dict["repo_overview"] = repo_overview
        if lsp is not UNSET:
            field_dict["lsp"] = lsp
        if doom_loop is not UNSET:
            field_dict["doom_loop"] = doom_loop
        if skill is not UNSET:
            field_dict["skill"] = skill

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_object_config import PermissionObjectConfig

        d = dict(src_dict)

        def _parse_read(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        read = _parse_read(d.pop("read", UNSET))

        def _parse_edit(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        edit = _parse_edit(d.pop("edit", UNSET))

        def _parse_glob(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        glob = _parse_glob(d.pop("glob", UNSET))

        def _parse_grep(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        grep = _parse_grep(d.pop("grep", UNSET))

        def _parse_list_(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        list_ = _parse_list_(d.pop("list", UNSET))

        def _parse_bash(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        bash = _parse_bash(d.pop("bash", UNSET))

        def _parse_task(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        task = _parse_task(d.pop("task", UNSET))

        def _parse_external_directory(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        external_directory = _parse_external_directory(d.pop("external_directory", UNSET))

        _todowrite = d.pop("todowrite", UNSET)
        todowrite: PermissionActionConfig | Unset
        if isinstance(_todowrite, Unset):
            todowrite = UNSET
        else:
            todowrite = PermissionActionConfig(_todowrite)

        _question = d.pop("question", UNSET)
        question: PermissionActionConfig | Unset
        if isinstance(_question, Unset):
            question = UNSET
        else:
            question = PermissionActionConfig(_question)

        _webfetch = d.pop("webfetch", UNSET)
        webfetch: PermissionActionConfig | Unset
        if isinstance(_webfetch, Unset):
            webfetch = UNSET
        else:
            webfetch = PermissionActionConfig(_webfetch)

        _websearch = d.pop("websearch", UNSET)
        websearch: PermissionActionConfig | Unset
        if isinstance(_websearch, Unset):
            websearch = UNSET
        else:
            websearch = PermissionActionConfig(_websearch)

        def _parse_repo_clone(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        repo_clone = _parse_repo_clone(d.pop("repo_clone", UNSET))

        def _parse_repo_overview(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        repo_overview = _parse_repo_overview(d.pop("repo_overview", UNSET))

        def _parse_lsp(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        lsp = _parse_lsp(d.pop("lsp", UNSET))

        _doom_loop = d.pop("doom_loop", UNSET)
        doom_loop: PermissionActionConfig | Unset
        if isinstance(_doom_loop, Unset):
            doom_loop = UNSET
        else:
            doom_loop = PermissionActionConfig(_doom_loop)

        def _parse_skill(data: object) -> PermissionActionConfig | PermissionObjectConfig | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_rule_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

            return componentsschemas_permission_rule_config_type_1

        skill = _parse_skill(d.pop("skill", UNSET))

        permission_config_type_1 = cls(
            read=read,
            edit=edit,
            glob=glob,
            grep=grep,
            list_=list_,
            bash=bash,
            task=task,
            external_directory=external_directory,
            todowrite=todowrite,
            question=question,
            webfetch=webfetch,
            websearch=websearch,
            repo_clone=repo_clone,
            repo_overview=repo_overview,
            lsp=lsp,
            doom_loop=doom_loop,
            skill=skill,
        )

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(data: object) -> PermissionActionConfig | PermissionObjectConfig:
                try:
                    if not isinstance(data, str):
                        raise TypeError()
                    componentsschemas_permission_rule_config_type_0 = PermissionActionConfig(data)

                    return componentsschemas_permission_rule_config_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_permission_rule_config_type_1 = PermissionObjectConfig.from_dict(data)

                return componentsschemas_permission_rule_config_type_1

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        permission_config_type_1.additional_properties = additional_properties
        return permission_config_type_1

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> PermissionActionConfig | PermissionObjectConfig:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: PermissionActionConfig | PermissionObjectConfig) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
