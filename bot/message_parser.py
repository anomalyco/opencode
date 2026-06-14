"""Парсер сообщений OpenCode."""

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class Part:
    id: str
    type: str
    text: Optional[str] = None


@dataclass
class ParsedSession:
    assistant_texts: List[str]
    assistant_reasonings: List[str]
    user_messages: List[str]


def parse_session_messages(messages: List[dict]) -> ParsedSession:
    """
    Парсит историю сообщений из OpenCode API (новый формат v2).

    Returns:
        ParsedSession с текстами assistant, рассуждениями и сообщениями пользователя
    """
    assistant_texts: List[str] = []
    assistant_reasonings: List[str] = []
    user_messages: List[str] = []

    for msg in messages:
        role = msg.get("type", "")

        if role == "user":
            text = msg.get("text", "")
            if text:
                user_messages.append(text)
            continue

        if role != "assistant":
            continue

        for part in msg.get("content", []):
            part_type = part.get("type", "")
            part_text = part.get("text")
            if part_type == "text" and part_text:
                assistant_texts.append(part_text)
            elif part_type == "reasoning" and part_text:
                assistant_reasonings.append(part_text)

    return ParsedSession(
        assistant_texts=assistant_texts,
        assistant_reasonings=assistant_reasonings,
        user_messages=user_messages,
    )


def get_new_parts(messages: List[dict], seen_part_ids: set) -> List[Part]:
    """
    Возвращает новые Part из сообщений ассистента (новый формат v2 API).

    Формат API:
    - msg["type"] — роль ("assistant", "user")
    - msg["content"] — список частей (для assistant)

    Поддерживаемые типы частей:
        - "text"      -> text = part.get("text", "")
        - "reasoning" -> text = part.get("text", "")
        - "tool"      -> text = part.get("tool", "") + " - " + part.get("state", {}).get("status", "")

    Args:
        messages: список сообщений от API
        seen_part_ids: множество id уже обработанных сообщений/частей

    Returns:
        List[Part] — новые части
    """
    new_parts: List[Part] = []

    for msg in messages:
        if msg.get("type") != "assistant":
            continue

        msg_id = msg.get("id", "")

        # Трекаем по ID сообщения — если сообщение уже_seen, пропускаем все его части
        if msg_id and msg_id in seen_part_ids:
            continue

        for part in msg.get("content", []):
            part_id = part.get("id", "")

            # Генерируем уникальный ID: msg_id:part_id
            unique_id = f"{msg_id}:{part_id}" if msg_id and part_id else part_id
            if not unique_id:
                continue

            # Проверяем и полный уникальный ID, и голый part_id (обратная совместимость)
            if unique_id in seen_part_ids or part_id in seen_part_ids:
                continue

            part_type = part.get("type", "")

            if part_type == "text":
                text = part.get("text", "")
            elif part_type == "reasoning":
                text = part.get("text", "")
            elif part_type == "tool":
                text = (
                    part.get("tool", "")
                    + " - "
                    + part.get("state", {}).get("status", "")
                )
            else:
                continue

            new_parts.append(Part(id=unique_id, type=part_type, text=text))

    return new_parts
