# Документация по OpenCode Server Docker

В этом руководстве рассматривается запуск OpenCode в серверном режиме внутри контейнеров Docker.

## Введение

OpenCode Server — это автономное развёртывание OpenCode, которое работает как фоновый сервис и доступно через HTTP API. Образ Docker предоставляет полноценную среду выполнения со всеми необходимыми инструментами, что делает его идеальным для:

- Удалённых сред разработки
- Интеграции CI/CD
- Общих экземпляров кодирования для команд
- Запуска OpenCode на серверах без графического интерфейса

## Быстрый старт

Запустите OpenCode Server с безопасным паролем:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Доступ к серверу по адресу `http://localhost:3000`.

## Варианты образа

Доступны два варианта базового образа:

| Вариант  | Базовый образ      | Размер | Сценарий использования                      |
| -------- | ------------------ | ------ | ------------------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB | Рекомендуется для большинства пользователей |
| `alpine` | Alpine Edge        | ~200MB | Минимальный размер, быстрее загрузка        |

### Загрузка определённых вариантов

```bash
# Debian (рекомендуется)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (минимальный)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Переменные окружения

| Переменная                 | По умолчанию                  | Описание                                              |
| -------------------------- | ----------------------------- | ----------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (нет)                         | **Обязательно.** Пароль для HTTP Basic аутентификации |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Имя пользователя для HTTP Basic аутентификации        |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Каталог конфигурации                                  |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Каталог кэша                                          |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Каталог данных                                        |

### Параметры сервера (флаги CLI)

Сервер принимает эти дополнительные параметры при переопределении команды по умолчанию:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Флаг            | По умолчанию     | Описание                           |
| --------------- | ---------------- | ---------------------------------- |
| `--port`        | `0` (случайный)  | Порт для прослушивания             |
| `--hostname`    | `127.0.0.1`      | Имя хоста для привязки             |
| `--mdns`        | `false`          | Включить обнаружение сервисов mDNS |
| `--mdns-domain` | `opencode.local` | Пользовательское доменное имя mDNS |
| `--cors`        | `[]`             | Дополнительные домены CORS         |

## Монтирование томов

Смонтируйте эти тома для сохранения данных и предоставления общих ресурсов:

### Рабочая область (Обязательно)

```bash
-v /path/to/workspace:/workspace
```

Здесь OpenCode работает с файлами проекта. Смонтируйте ваш репозиторий кода сюда.

### SSH-ключи

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Доступ только для чтения к SSH-ключам для клонирования приватных репозиториев.

### Конфигурация Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Наследование идентификатора пользователя Git от хоста.

### Конфигурация OpenCode

```bash
v ~/.config/opencode:/home/opencode/.config/opencode
```

Сохранение настроек OpenCode между перезапусками контейнера.

### Кэш

```bash
-v opencode_cache:/home/opencode/.cache
```

Кэш npm-пакетов, языковых серверов и других загруженных инструментов.

## Порты

| Порт   | Протокол | Описание                            |
| ------ | -------- | ----------------------------------- |
| `3000` | HTTP     | Основной API сервера (по умолчанию) |

Порт можно переназначить через флаг `-p` Docker:

```bash
-p 8080:3000  # Доступ к серверу по http://localhost:8080
```

## Пользователь и разрешения

Контейнер работает от непривилегированного пользователя (`opencode`, UID 1000) в целях безопасности. Этот пользователь имеет доступ к `sudo` без пароля для административных задач:

```bash
# Выполнить команды от имени пользователя opencode
docker exec -it opencode-server sudo -u opencode <command>

# Получить оболочку от имени пользователя opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Если вам нужен доступ root:

```bash
docker exec -it opencode-server /bin/bash
```

## Установленные инструменты

Образ включает эти инструменты из коробки:

| Инструмент        | Описание                                       |
| ----------------- | ---------------------------------------------- |
| `opencode`        | CLI OpenCode                                   |
| `bun`             | Среда выполнения JavaScript и менеджер пакетов |
| `bunx`            | Эквивалент Bun для npx (запуск npm-пакетов)    |
| `uv`              | Менеджер пакетов Python                        |
| `git`             | Система контроля версий                        |
| `git-lfs`         | Расширение Git для хранения больших файлов     |
| `build-essential` | GCC, make и библиотеки сборки                  |
| `curl`            | HTTP-клиент                                    |
| `wget`            | Утилита для загрузки файлов                    |
| `openssh-client`  | SSH-клиент и инструменты для ключей            |
| `xz-utils`        | Утилиты сжатия                                 |

### Использование bun

```bash
# Запустить Node.js-пакет
docker exec -it opencode-server bunx create-next-app

# Установить зависимости
docker exec -it opencode-server bun install
```

### Использование uv

```bash
# Установить Python-пакет
docker exec -it opencode-server uv pip install pandas

# Запустить Python-скрипт
docker exec -it opencode-server uv run script.py
```

### Использование git

```bash
# Клонировать репозиторий в рабочую область
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Проверка состояния

Контейнер включает встроенную проверку состояния, которая проверяет, отвечает ли сервер:

```bash
# Проверить состояние контейнера
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Эндпоинт состояния возвращает HTTP 200, когда сервер здоров:

```bash
# Ручная проверка состояния
curl -f http://localhost:3000/health
```

Конфигурация проверки состояния:

- Интервал: 30 секунд
- Тайм-аут: 10 секунд
- Начальный период: 10 секунд
- Повторные попытки: 3

## Пример Docker Compose

Создайте файл `docker-compose.yml`:

```yaml
services:
  opencode:
    image: ghcr.io/anomalyco/opencode/server:debian
    container_name: opencode-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - OPENCODE_SERVER_PASSWORD=your_secure_password
      - OPENCODE_SERVER_USERNAME=opencode
    volumes:
      - ./workspace:/workspace
      - opencode_config:/home/opencode/.config
      - opencode_cache:/home/opencode/.cache
      - ~/.ssh:/home/opencode/.ssh:ro
      - ~/.gitconfig:/home/opencode/.gitconfig:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  opencode_config:
  opencode_cache:
```

Запустите стек:

```bash
docker-compose up -d
```

## Сборка из исходного кода

Для сборки образа сервера из исходного кода:

### Клонируйте репозиторий

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Сборка варианта Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Сборка варианта Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Запустите локальную сборку

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Устранение неполадок

### Сервер не запускается

Проверьте журналы:

```bash
docker logs opencode-server
```

Распространённые проблемы:

- Отсутствует `OPENCODE_SERVER_PASSWORD` — сервер отказывается запускаться без аутентификации
- Порт уже используется — измените сопоставление портов хоста

### Ошибка аутентификации

Убедитесь, что пароль точно соответствует. Сервер использует HTTP Basic Auth:

```bash
# Проверить аутентификацию
curl -u opencode:your_password http://localhost:3000/health
```

### Ошибки разрешений рабочей области

Убедитесь, что смонтированный каталог доступен для записи UID 1000:

```bash
# Исправить владельца
sudo chown -R 1000:1000 /path/to/workspace
```

### Медленный запуск

При первом запуске загружаются языковые серверы и инструменты. Проверьте прогресс:

```bash
docker logs -f opencode-server
```

### Контейнер не может подключиться к интернету

Проверьте конфигурацию DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Проверка состояния не работает

Убедитесь, что сервер действительно запущен:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH-ключ не работает

Убедитесь в правильных разрешениях ключей внутри контейнера:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
