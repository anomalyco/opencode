from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        todos = []
        for todos_item_data in self.todos:
            todos_item = todos_item_data.to_dict()
            todos.append(todos_item)

        field_dict: dict[str, Any] = {}

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

        return event_todo_updated_properties
