# OpenCode VK Gateway

VK-бот для работы с [OpenCode](https://opencode.ai) - AI-ассистентом для программирования.

## Возможности

- Взаимодействие с OpenCode через VK-мессенджер
- Управление несколькими моделями Llama.cpp с переключением по команде
- Поддержка сессий с историей и дедупликацией сообщений
- Отправка промежуточных рассуждений (reasoning) в отдельный чат
- Перезапуск моделей и opencode serve без перезапуска бота
- Обработка запросов разрешений (чтение файлов, доступ к директориям) через inline-кнопки
- Обработка вопросов от opencode с клавиатурой опций
- Отправка длинных ответов частями (лимит VK 4090 символов)
- Информация о GPU через nvidia-smi

## Требования

- Python 3.12+
- VK API токен
- [opencode](https://opencode.ai) бинарник
- [llama.cpp](https://github.com/ggerganov/llama.cpp) сервер
- tmux (для управления llama-server в сессии)
- nvidia-smi (опционально, для команды /gpu)

## Установка

1. Клонировать репозиторий:
```bash
git clone https://github.com/Grigory-Rylov/opencode-vk-gateway.git
cd opencode-vk-gateway
```

2. Создать виртуальное окружение:
```bash
python3 -m venv venv
source venv/bin/activate
```

3. Установить зависимости:
```bash
pip install -r requirements.txt
```

4. Скопировать и настроить конфиг:
```bash
cp config.json.example config.json
# Отредактировать config.json, указав свой VK токен и пути к моделям
```

## Настройка

В `config.json`:

| Параметр | Описание | По умолчанию |
|----------|----------|-------------|
| `vk_token` | VK API токен (получить [тут](https://vk.com/dev)) | — |
| `opencode_url` | URL opencode serve | `http://127.0.0.1:4096` |
| `session_file` | Файл хранения сессий | `sessions.json` |
| `vk_api_version` | Версия VK API | `5.200` |
| `longpoll_wait` | Время ожидания longpoll (сек) | `25` |
| `peer_id` | ID чата/пользователя для бота | — |
| `thinking_peer_id` | ID чата для отправки рассуждений | `2000000506` |
| `model` | Модель по умолчанию `провайдер/название` | — |
| `opencode_bin_path` | Путь к бинарнику opencode | — |
| `llama_server_path` | Путь к llama-server | `llama-server` |
| `llama_server_host` | URL llama-server | `http://localhost:8081` |
| `models` | Словарь моделей и параметров запуска | — |
| `default_model` | Алиас модели по умолчанию | — |
| `mcp_servers` | (опционально) MCP серверы для opencode | — |

### Формат модели

Модель указывается строкой формата `провайдер/название`:
```json
"model": "llama.cpp/qwen3.6-claude"
```

Для каждой модели в секции `models`:
```json
"models": {
  "qwen3.6-claude": {
    "model": "llama.cpp/qwen3.6-claude",
    "args": "-m /path/to/model.gguf --port 8081 ..."
  }
}
```

## Архитектура

Проект разделён на модули с разделением ответственности:

| Модуль | Назначение |
|--------|-----------|
| `main.py` | Точка входа, инициализация и запуск |
| `config.py` | Загрузка конфигурации, аргументы CLI |
| `logging_config.py` | Настройка логирования |
| `models.py` | Управление моделями и форматирование API |
| `llama_server.py` | Жизненный цикл llama-server |
| `opencode_process.py` | Управление процессом opencode serve |
| `session_manager.py` | Управление сессиями и дедупликация |
| `vk_client.py` | VK API клиент, разрешения, вопросы |
| `vk_longpoll.py` | VK longpoll, маршрутизация сообщений |
| `nvidia.py` | Парсинг GPU информации |
| `gateway-restarter.py` | Сервис перезапуска через `/update` |

## Принцип работы

### Подмена конфига OpenCode

OpenCode требует настройку провайдера для подключения к локальному llama-server. При старте бота и при переключении модели происходит автоматическое обновление конфига `~/.config/opencode/opencode.json`.

#### MCP серверы

В секцию `mcp_servers` config.json можно добавить MCP серверы которые будут доступны в opencode:

```json
{
  "mcp_servers": {
    "ya-disk-uploader": {
      "type": "local",
      "command": ["/path/to/ya-disk-uploader/ya-disk-uploader", "mcp"],
      "enabled": true
    }
  }
}
```

Если секция `mcp_servers` не указана или пуста, MCP серверы не будут добавлены.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "llama.cpp/название-модели",
  "provider": {
    "llama.cpp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-server (local)",
      "options": {
        "baseURL": "http://localhost:8081/v1"
      },
      "models": {
        "название-модели": {
          "name": "название-модели (local)"
        }
      }
    }
  }
}
```

### Переключение моделей

Команда `/restart` или `/r` выполняет:
1. Остановка текущего llama-server
2. Запуск llama-server с новой моделью
3. Обновление конфига OpenCode (подмена provider с новой моделью)
4. Ожидание загрузки модели (до 5 минут, проверка пингом)
5. Перезапуск opencode serve для применения нового конфига
6. Очистка сессии пользователя после переключения

## Запуск

### Режим перезапуска (ожидает команду /update)

```bash
python gateway-restarter.py
```

Запускает бота, который слушает VK и при получении команды `/update` перезапускает основной шлюз.

### Прямой запуск

```bash
python main.py
```

### Аргументы командной строки

| Аргумент | Описание |
|----------|----------|
| `--config <путь>` | Путь к файлу конфигурации |
| `-d, --debug` | Включить debug логирование в файл |

## Команды бота

| Команда | Описание |
|---------|----------|
| `/help` | Показать справку со всеми командами |
| `/restart` | Перезапустить с текущей моделью |
| `/restart <модель>` | Перезапустить с указанной моделью |
| `/r <модель>` | То же что `/restart <модель>` |
| `/models` или `/m` | Показать доступные модели |
| `/history` | Получить историю сессии файлом |
| `/history <session_id>` | Получить историю конкретной сессии |
| `/newsession` или `/n` | Создать новую сессию |
| `/newsession <путь>` | Создать новую сессию с указанным рабочим каталогом |
| `/sessions` | Показать список всех сессий |
| `/clearsessions` | Удалить все сессии |
| `/gpu` | Показать информацию о GPU (nvidia-smi) |
| `/logs` | Отправить файл логов |

## Systemd сервис (Linux)

Пример `~/.config/systemd/user/gateway.service`:

```ini
[Unit]
Description=VK Gateway Autostart
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/opencode-vk-gateway
ExecStart=/path/to/opencode-vk-gateway/venv/bin/python /path/to/opencode-vk-gateway/gateway-restarter.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

Запуск:
```bash
systemctl --user enable gateway.service
systemctl --user start gateway.service
```

## API OpenCode — Структуры данных и взаимодействие

### Обзор архитектуры

Бот работает как bridge между VK и OpenCode API. Основные компоненты:

```
┌─────────┐     ┌──────────────────┐     ┌─────────────┐
│   VK    │────▶│  VK LongPoll     │────▶│ OpenCode    │
│  API    │     │  (poller + router)│     │  API        │
└─────────┘     └──────────────────┘     └─────────────┘
                        │                        │
                  ┌─────┴──────┐            ┌────┴─────┐
                  │ VK         │            │ Session  │
                  │ Client     │            │ Manager  │
                  └────────────┘            └──────────┘
```

### Жизненный цикл обработки сообщения

```
Пользователь отправляет сообщение
    │
    ▼
VK LongPoll получает событие (type=4, message_new)
    │
    ▼
Извлекает команду (если есть) или отправляет в OpenCode
    │
    ▼
Создаёт/получает сессию → запускает session poller
    │
    ▼
Session poller каждые 4 секунды:
  1. get_session_messages() → get_new_parts() → отправляет частями
  2. get_pending_permissions() → обрабатывает запросы
  3. get_pending_questions() → показывает вопросы
```

---

### 1. Сессии (Sessions)

#### Создание сессии

**Endpoint:** `POST /session`

**Request:**
```json
{
  "model": "llama.cpp/qwen3.6-claude",
  "provider": {
    "llama.cpp": {
      "name": "llama-server (local)",
      "options": {
        "baseURL": "http://localhost:8081/v1"
      }
    }
  }
}
```

**Response:**
```json
{
  "id": "ses_20bd47a16ffeXPCW9u3dAQulu1"
}
```

**Когда вызывается:**
- При первом сообщении от пользователя (`SessionManager.get_or_create()`)
- При команде `/newsession` (`VKLongPoll._new_session()`)
- При команде `/restart` сессия очищается и пересоздаётся

**Хранение:** `sessions.json` — мапа `user_id → session_id`

---

### 2. Сообщения сессии (Session Messages)

#### Получение сообщений

**Endpoint:** `GET /session/{session_id}/message?limit=20`

**Response (массив message parts):**
```json
[
  {
    "id": "prt_df44d545b001mmG7Uu1H47Ru05",
    "sessionID": "ses_20bd47a16ffeXPCW9u3dAQulu1",
    "messageID": "msg_df44d52fd001i6Md5GRCPabxoB",
    "type": "text",
    "text": "Привет! Чем могу помочь?",
    "time": {"start": 1777920201819, "end": 1777920202086}
  },
  {
    "id": "prt_df44d545b001mmG7Uu1H47Ru06",
    "type": "reasoning",
    "text": "Пользователь спрашивает о..."
  },
  {
    "id": "prt_df44d63f9001UDJBGIcwtSVOGr",
    "type": "tool",
    "tool": "write",
    "callID": "hC9C6DGpMOHjKNy7fZgEGSCCh4u8CJNd",
    "state": {"status": "completed"},
    "text": "Wrote file successfully."
  }
]
```

**Типы частей (part types):**

| Тип | Описание | Куда отправляется |
|-----|----------|-------------------|
| `text` | Ответ модели | Пользователю (`user_id`) |
| `reasoning` | Внутренние рассуждения | Thinking peer (`THINKING_PEER_ID`) |
| `tool` | Результат выполнения инструмента | Thinking peer |

**Дедупликация:** `session_mgr.seen_messages[session_id]` — хранит `part.id`, чтобы не дублировать части

**Когда вызывается:** Каждые 4 секунды в session poller (`VKLongPoll._poll_session_messages()`)

---

### 3. Запросы разрешений (Permissions)

#### Получение pending permissions

**Endpoint:** `GET /permission`

**Response:**
```json
[
  {
    "id": "uuid-permission",
    "session_id": "ses_xxx",
    "tool_call_id": "call_xxx",
    "tool_name": "write",
    "description": "Write file",
    "action": "write_file",
    "params": {
      "file_path": "/home/user/project/main.py",
      "content": "..."
    },
    "path": "/home/user/project/main.py"
  }
]
```

#### Поддерживаемые форматы API

**Crush (новый, основной):**
```json
{
  "id": "uuid",
  "session_id": "ses_xxx",
  "tool_name": "write",
  "action": "write_file",
  "params": {...},
  "path": "/home/user/file.txt"
}
```

**Legacy (старый opencode):**
```json
{
  "id": "uuid",
  "sessionID": "ses_xxx",
  "permission": "write_file",
  "metadata": {
    "filepath": "/home/user/file.txt",
    "parentDir": "/home/user/"
  }
}
```

#### Типы разрешений

| Permission/Action | Tool Name | Описание |
|-------------------|-----------|----------|
| `write_file`, `edit`, `multi_edit` | `write`, `edit` | Запись/редактирование файлов |
| `read_file`, `view`, `read` | `view`, `read` | Чтение файлов |
| `external_directory` | — | Доступ к директории |
| `bash` | `bash` | Выполнение команд |

#### Отправка ответа на разрешение

**Endpoint:** `POST /session/{session_id}/permissions/{permission_id}`

**Request:**
```json
{
  "response": "always"
}
```

**Возможные ответы:**

| Ответ | Поведение |
|-------|-----------|
| `"always"` | Разрешить навсегда (сохраняется в session permissions) |
| `"once"` | Разрешить разово |
| `"never"` | Запретить навсегда |

**Когда вызывается:** Пользователь нажимает кнопку на клавиатуре разрешения

#### Клавиатура разрешения

```
┌──────────────────────────────────────┐
│ ✅ Навсегда    🔄 Разово    ❌ Никогда│
└──────────────────────────────────────┘
```

---

### 4. Вопросы (Questions)

#### Получение pending вопросов

**Endpoint:** `GET /question`

**Response:**
```json
[
  {
    "id": "question-uuid",
    "session_id": "ses_xxx",
    "questions": [
      {
        "id": "question-uuid",
        "header": "Подтвердите действие",
        "question": "Хотите перезаписать файл?",
        "options": [
          {"label": "✅ Да, перезаписать"},
          {"label": "❌ Нет, отменить"}
        ]
      }
    ]
  }
]
```

**Гибкая структура:** вопрос может быть вложен в `questions[]` или быть на top-level. Поля также поддерживают разные имена:
- `header` / `title` — заголовок
- `question` / `text` / `description` / `prompt` — текст вопроса
- `options` / `choices` — варианты ответа

#### Отправка ответа на вопрос

**Endpoint:** `POST /question/{question_id}/reply`

**Request:**
```json
{
  "answers": [["✅ Да, перезаписать"]]
}
```

**Когда вызывается:** Пользователь выбирает опцию на клавиатуре вопроса

#### Клавиатура вопроса

Каждая опция — отдельная кнопка. Формат опции:
```json
{"label": "✅ Да"}
```

---

### 5. Отправка промпта (Prompt)

#### Отправка запроса

**Endpoint:** `POST /session/{session_id}/prompt_async`

**Request:**
```json
{
  "parts": [
    {
      "type": "text",
      "text": "Привет, помоги с кодом"
    }
  ]
}
```

**Response:** `204 No Content` — успешно

**Обработка аттачей:** При наличии вложений файлы скачиваются в `ATTACHES_DIR`, и текст дополняется информацией:
```
📥 Downloaded 2 file(s):
• [document] `report.pdf` saved to: `/home/user/attaches/...`
```

---

### 6. VK LongPoll архитектура

#### Инициализация

1. Получение сервера longpoll: `GET /longpoll/server`
2. Получение ключа и ts: `GET /longpoll/get_update_key`

#### Получение событий

**Endpoint:** `GET https://{server}/?act=a_check&key={key}&ts={ts}&wait={wait}&mode=74&version=3`

**Response:**
```json
{
  "ts": "1234567",
  "updates": [
    [4, 12345, 256, 123456789, 0, "Hello"]
  ]
}
```

**Структура события message_new:**
```
[4, msg_id, flags, peer_id, ?, text]
  │   │       │       │       │    └─ текст
  │   │       │       │       └─ (пропущено)
  │   │       │       └─ peer_id (user_id)
  │   │       └─ flags (2 = от бота, пропускаем)
  │   └─ msg_id
  └─ 4 = тип события (new message)
```

**Коды ошибок:**

| Код | Действие |
|-----|----------|
| 1 | История устарела, нужен новый ts |
| 2 | Ключ истёк, нужно обновить |
| 3 | Информация потеряна, нужно обновить |

---

### 7. Session Poller — циклическая обработка

Каждые **4 секунды** poller выполняет:

```python
async def _poll_session_messages(session_id, user_id):
    while running:
        # 1. Получить новые части сообщений
        messages = await get_session_messages(session_id)
        new_parts = get_new_message_parts(messages, seen_messages)
        
        for part in new_parts:
            if part.type == "tool":
                send_to(peer_id=THINKING_PEER_ID)  # 🧠: Tool
            elif part.type == "reasoning":
                send_to(peer_id=THINKING_PEER_ID)  # 🧠:
            else:
                send_to(peer_id=user_id)           # текст
        
        # 2. Проверить новые разрешения
        permissions = await get_pending_permissions()
        for perm in permissions:
            if perm.id not in seen_permissions:
                show_permission_request(perm)
        
        # 3. Проверить новые вопросы
        questions = await get_pending_questions()
        for q in questions:
            if q.id not in seen_questions:
                show_question(q)
```

---

### 8. Обработка ответов пользователя

#### Ответ на разрешение

Пользователь отправляет текст → проверяем по `pending_permissions`:

```python
for permission_id, (session_id, user_id, msg_id) in pending_permissions.items():
    if user_id == current_user_id:
        answer = text.strip().lower()
        if "навсегда" in answer:
            response = "always"
        elif "разово" in answer:
            response = "once"
        elif "никогда" in answer:
            response = "never"
        
        await send_permission_response(session_id, permission_id, response)
        await edit_message(msg_id, result_text, keyboard=main_keyboard)
```

#### Ответ на вопрос

Пользователь отправляет текст → проверяем `waiting_for_answer`:

```python
if user_id in waiting_for_answer:
    question_id = waiting_for_answer.pop(user_id)
    await send_question_answer(question_id, answer)
```

---

### 9. Flowchart — полный цикл

```
┌─────────────────────────────────────────────────────────────┐
│                    STARTUP                                   │
│  1. Load config                                              │
│  2. Start llama-server                                       │
│  3. Start opencode serve                                     │
│  4. Initialize VK LongPoll                                   │
│  5. Start listening for /update (if restart mode)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              VK LONGPOLL LOOP                                │
│  1. Wait for events (a_check)                                │
│  2. Handle type=4 (message_new)                              │
│      ├─ Extract command                                      │
│      ├─ Handle /restart, /models, /help etc.                 │
│      ├─ Handle question answer                               │
│      ├─ Handle permission answer                             │
│      └─ Handle normal message                                │
│          ├─ Get/create session                               │
│          ├─ Download attachments                             │
│          ├─ Send prompt to OpenCode                          │
│          └─ Start session poller                             │
│  3. Handle failed codes (1,2,3) → refresh server             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SESSION POLLER (4s interval)                    │
│  1. get_session_messages(session_id)                         │
│  2. get_new_message_parts()                                  │
│     ├─ Filter already seen parts (dedup)                     │
│     ├─ Send "text" → user_id                                 │
│     ├─ Send "reasoning" → thinking_peer                      │
│     └─ Send "tool" → thinking_peer                           │
│  3. get_pending_permissions()                                │
│     ├─ Filter already seen                                   │
│     ├─ Format message                                        │
│     ├─ Send with keyboard                                    │
│     └─ Track in pending_permissions                          │
│  4. get_pending_questions()                                  │
│     ├─ Filter already seen                                   │
│     ├─ Extract question data                                 │
│     ├─ Show with keyboard                                    │
│     └─ Track in waiting_for_answer                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Структура проекта

| Файл | Назначение |
|------|-----------|
| `main.py` | Точка входа, инициализация и запуск |
| `gateway-restarter.py` | Сервис перезапуска (слушает `/update`) |
| `config.py` | Загрузка конфигурации и аргументы CLI |
| `config.json.example` | Шаблон конфигурации |
| `models.py` | Управление моделями |
| `llama_server.py` | Управление llama-server |
| `opencode_process.py` | Управление процессом opencode |
| `session_manager.py` | Управление сессиями |
| `vk_client.py` | VK API клиент |
| `vk_longpoll.py` | VK longpoll слушатель |
| `opencode_client.py` | Клиент API opencode |
| `nvidia.py` | Парсер nvidia-smi |
| `logging_config.py` | Настройка логирования |
| `requirements.txt` | Зависимости Python |