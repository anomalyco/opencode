"""Тесты парсера сообщений OpenCode."""

import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
MESSAGES_FILE = os.path.join(FIXTURES_DIR, "session_messages.json")


def download_messages(limit: int = 20) -> list:
    """Скачать сообщения из API и сохранить в файл."""
    result = subprocess.run(
        ["curl", "-s", f"http://localhost:4096/session/ses_1e7b46739ffeDV1M7q9QrxZF8j/message?limit={limit}"],
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        raise Exception(f"Failed to get messages: {result.stderr}")
    messages = json.loads(result.stdout)

    os.makedirs(FIXTURES_DIR, exist_ok=True)
    with open(MESSAGES_FILE, "w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(messages)} messages to {MESSAGES_FILE}")
    return messages


def load_messages() -> list:
    """Загрузить сообщения из файла."""
    if not os.path.exists(MESSAGES_FILE):
        raise FileNotFoundError(
            f"Fixtures file not found: {MESSAGES_FILE}\n"
            f"Run 'python test_message_parser.py --download' to fetch messages."
        )
    with open(MESSAGES_FILE, encoding="utf-8") as f:
        return json.load(f)


class TestMessageParser(unittest.TestCase):
    def setUp(self):
        self.messages = load_messages()
        from message_parser import parse_session_messages, get_new_parts, ParsedSession
        self.parse_session_messages = parse_session_messages
        self.get_new_parts = get_new_parts
        self.ParsedSession = ParsedSession

    def test_parse_all_messages(self):
        """Тест: парсер корректно обрабатывает все сообщения из файла."""
        parsed = self.parse_session_messages(self.messages)

        self.assertIsInstance(parsed, self.ParsedSession)
        self.assertGreater(len(parsed.assistant_texts), 0, "Should have assistant texts")
        self.assertGreater(len(parsed.user_messages), 0, "Should have user messages")

        print(f"✓ Found {len(parsed.assistant_texts)} assistant texts")
        print(f"✓ Found {len(parsed.assistant_reasonings)} reasonings")
        print(f"✓ Found {len(parsed.user_messages)} user messages")

    def test_get_new_parts_empty_seen(self):
        """Тест: get_new_parts с пустым seen_part_ids."""
        new_texts, new_reasonings = self.get_new_parts(self.messages, set())

        self.assertGreater(len(new_texts), 0, "Should find new texts with empty seen set")
        print(f"✓ With empty seen set: {len(new_texts)} texts, {len(new_reasonings)} reasonings")

    def test_get_new_parts_all_seen(self):
        """Тест: get_new_parts - все part_ids уже в seen."""
        all_part_ids = set()
        for msg in self.messages:
            for part in msg.get("parts", []):
                pid = part.get("id", "")
                if pid:
                    all_part_ids.add(pid)

        new_texts, new_reasonings = self.get_new_parts(self.messages, all_part_ids)

        self.assertEqual(len(new_texts), 0, "Should find no new texts when all seen")
        self.assertEqual(len(new_reasonings), 0, "Should find no new reasonings when all seen")
        print(f"✓ With all seen: {len(new_texts)} texts, {len(new_reasonings)} reasonings")

    def test_last_assistant_text(self):
        """Тест: последний ответ assistant есть в результатах."""
        parsed = self.parse_session_messages(self.messages)
        assistant_texts = parsed.assistant_texts
        if assistant_texts:
            last_text = assistant_texts[-1]
            self.assertIsInstance(last_text, str)
            self.assertGreater(len(last_text), 0)
            print(f"✓ Last assistant text: {last_text[:50]}...")

    def test_fixtures_exist(self):
        """Тест: fixtures файл существует и содержит данные."""
        self.assertTrue(os.path.exists(MESSAGES_FILE), f"Fixtures file not found: {MESSAGES_FILE}")
        self.assertGreater(len(self.messages), 0, "Messages file is empty")


if __name__ == "__main__":
    if "--download" in sys.argv:
        download_messages()
        sys.exit(0)
    unittest.main(verbosity=2)
