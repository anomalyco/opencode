"""
Клавиатуры для VK бота.
"""
from typing import List


def get_main_keyboard() -> dict:
    """
    Основная клавиатура с часто используемыми командами.
    Отображается по умолчанию.
    """
    return {
        "inline": False,
        "buttons": [
            [
                {
                    "action": {"type": "text", "label": "/help"},
                    "color": "primary",
                },
                {
                    "action": {"type": "text", "label": "/gpu"},
                    "color": "primary",
                },
                {
                    "action": {"type": "text", "label": "/status"},
                    "color": "primary",
                },
            ],
            [
                {
                    "action": {"type": "text", "label": "/logs"},
                    "color": "secondary",
                },
                {
                    "action": {"type": "text", "label": "/history"},
                    "color": "secondary",
                },
                {
                    "action": {"type": "text", "label": "/sessions"},
                    "color": "secondary",
                },
            ],
            [
                {
                    "action": {"type": "text", "label": "/newsession"},
                    "color": "positive",
                },
                {
                    "action": {"type": "text", "label": "/models"},
                    "color": "secondary",
                },
                {
                    "action": {"type": "text", "label": "/test-llama"},
                    "color": "positive",
                },
            ],
        ],
    }


def get_question_keyboard(options: List[dict]) -> dict:
    """
    Клавиатура для вопроса.
    Каждая опция - отдельная кнопка.
    """
    buttons = []
    for opt in options:
        buttons.append(
            [
                {
                    "action": {
                        "type": "text",
                        "label": opt["label"],
                    },
                    "color": "primary",
                }
            ]
        )
    return {"inline": False, "buttons": buttons}


def get_permission_keyboard() -> dict:
    """
    Клавиатура для запроса разрешения.
    """
    return {
        "inline": False,
        "buttons": [
            [
                {
                    "action": {"type": "text", "label": "✅ Навсегда"},
                    "color": "positive",
                },
                {
                    "action": {"type": "text", "label": "🔄 Разово"},
                    "color": "primary",
                },
                {
                    "action": {"type": "text", "label": "❌ Никогда"},
                    "color": "negative",
                },
            ]
        ],
    }
