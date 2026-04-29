from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.todo import Todo


T = TypeVar("T", bound="EventTodoUpdatedProperties")


@_attrs_define
class EventTodoUpdatedProperties:
    """
    Attributes:
        session_id (str):
        todos (list[Todo]):
    """

    session_id: str
    todos: list[Todo]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.todo import Todo

        session_id = self.session_id

        todos = []
        for todos_item_data in self.todos:
            todos_item = todos_item_data.to_dict()
            todos.append(todos_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionID": session_id,
                "todos": todos,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.todo import Todo

        d = dict(src_dict)
        session_id = d.pop("sessionID")

        todos = []
        _todos = d.pop("todos")
        for todos_item_data in _todos:
            todos_item = Todo.from_dict(todos_item_data)

            todos.append(todos_item)

        event_todo_updated_properties = cls(
            session_id=session_id,
            todos=todos,
        )

        event_todo_updated_properties.additional_properties = d
        return event_todo_updated_properties

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
