# Документація OpenCode Server Docker

Цей посібник охоплює запуск OpenCode у режимі сервера всередині Docker-контейнерів.

## Вступ

OpenCode Server — це headless-розгортання OpenCode, яке працює як фонова служба та доступне через HTTP API. Docker-образ надає повне середовище виконання з усіма необхідними інструментами, що робить його ідеальним для:

- Віддалених середовищ розробки
- Інтеграції CI/CD
- Спільних екземплярів кодування для команди
- Запуску OpenCode на серверах без GUI

## Швидкий старт

Запустіть OpenCode Server з безпечним паролем:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Доступ до сервера за адресою `http://localhost:3000`.

## Варіанти образу

Доступні два варіанти базового образу:

| Варіант  | Базовий образ      | Розмір | Випадок використання                     |
| -------- | ------------------ | ------ | ---------------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB | Рекомендовано для більшості користувачів |
| `alpine` | Alpine Edge        | ~200MB | Мінімальний розмір, швидше завантаження  |

### Завантаження конкретних варіантів

```bash
# Debian (рекомендовано)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (мінімальний)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Змінні середовища

| Змінна                     | За замовчуванням              | Опис                                        |
| -------------------------- | ----------------------------- | ------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (немає)                       | **Обов'язково.** Пароль для HTTP Basic auth |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Ім'я користувача для HTTP Basic auth        |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Каталог конфігурації                        |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Каталог кешу                                |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Каталог даних                               |

### Параметри сервера (CLI-прапорці)

Сервер приймає ці додаткові параметри під час перевизначення команди за замовчуванням:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Прапорець       | За замовчуванням | Опис                            |
| --------------- | ---------------- | ------------------------------- |
| `--port`        | `0` (випадковий) | Порт для прослуховування        |
| `--hostname`    | `127.0.0.1`      | Ім'я хоста для прив'язки        |
| `--mdns`        | `false`          | Увімкнути виявлення mDNS-служби |
| `--mdns-domain` | `opencode.local` | Власне доменне ім'я mDNS        |
| `--cors`        | `[]`             | Додаткові домени для CORS       |

## Монтування томів

Монтуйте ці томи для збереження даних та спільного використання ресурсів:

### Робочий простір (Обов'язково)

```bash
-v /path/to/workspace:/workspace
```

Тут OpenCode працює з файлами вашого проєкту. Змонтуйте сюди свій репозиторій коду.

### SSH-ключі

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Доступ лише для читання до SSH-ключів для клонування приватних репозиторіїв.

### Конфігурація Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

успадкувати ідентичність користувача Git від хост-системи.

### Конфігурація OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Зберігати налаштування OpenCode між перезапусками контейнера.

### Кеш

```bash
-v opencode_cache:/home/opencode/.cache
```

Кешувати npm-пакети, мовні сервери та інші завантажені інструменти.

## Порти

| Порт   | Протокол | Опис                                    |
| ------ | -------- | --------------------------------------- |
| `3000` | HTTP     | Основний API сервера (за замовчуванням) |

Порт можна перенаправити через прапорець Docker `-p`:

```bash
-p 8080:3000  # Доступ до сервера за http://localhost:8080
```

## Користувач та дозволи

Контейнер працює як не-root користувач (`opencode`, UID 1000) з міркувань безпеки. Цей користувач має sudo-доступ без пароля для адміністративних завдань:

```bash
# Виконати команду як користувач opencode
docker exec -it opencode-server sudo -u opencode <command>

# Отримати shell як користувач opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Якщо вам потрібен root-доступ:

```bash
docker exec -it opencode-server /bin/bash
```

## Встановлені інструменти

Образ включає ці інструменти:

| Інструмент        | Опис                                        |
| ----------------- | ------------------------------------------- |
| `opencode`        | OpenCode CLI                                |
| `bun`             | JavaScript runtime і package manager        |
| `bunx`            | еквівалент npx від Bun (запуск npm-пакетів) |
| `uv`              | Python package manager                      |
| `git`             | контроль версій                             |
| `git-lfs`         | розширення для великих файлів Git           |
| `build-essential` | GCC, make та бібліотеки збірки              |
| `curl`            | HTTP-клієнт                                 |
| `wget`            | утиліта для завантаження файлів             |
| `openssh-client`  | SSH-клієнт та інструменти для ключів        |
| `xz-utils`        | утиліти стиснення                           |

### Використання bun

```bash
# Запустити Node.js-пакет
docker exec -it opencode-server bunx create-next-app

# Встановити залежності
docker exec -it opencode-server bun install
```

### Використання uv

```bash
# Встановити Python-пакет
docker exec -it opencode-server uv pip install pandas

# Запустити Python-скрипт
docker exec -it opencode-server uv run script.py
```

### Використання git

```bash
# Клонувати репозиторій у робочий простір
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Перевірка стану

Контейнер включає вбудовану перевірку стану, яка перевіряє, чи сервер відповідає:

```bash
# Перевірити стан контейнера
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Ендпоінт стану повертає HTTP 200, коли система здорова:

```bash
# Ручна перевірка стану
curl -f http://localhost:3000/health
```

Конфігурація перевірки стану:

- Інтервал: 30 секунд
- Тайм-аут: 10 секунд
- Початковий період: 10 секунд
- Повтори: 3

## Приклад Docker Compose

Створіть файл `docker-compose.yml`:

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

Запустіть стек:

```bash
docker-compose up -d
```

## Збірка з вихідного коду

Для збірки образу сервера з вихідного коду:

### Клонувати репозиторій

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Збірка варіанту Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Збірка варіанту Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Запустити локальну збірку

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Виправлення проблем

### Сервер не запускається

Перевірте логи:

```bash
docker logs opencode-server
```

Поширені проблеми:

- Відсутній `OPENCODE_SERVER_PASSWORD` — сервер відмовляється запускатися без автентифікації
- Порт вже використовується — змініть маппінг портів хост-системи

### Помилка автентифікації

Переконайтеся, що пароль точно збігається. Сервер використовує HTTP Basic Auth:

```bash
# Тестування автентифікації
curl -u opencode:your_password http://localhost:3000/health
```

### Помилки прав робочого простору

Переконайтеся, що змонтований каталог доступний для запису UID 1000:

```bash
# Виправити власника
sudo chown -R 1000:1000 /path/to/workspace
```

### Повільний запуск

Перший запуск завантажує мовні сервери та інструменти. Перевірте прогрес:

```bash
docker logs -f opencode-server
```

### Контейнер не може підключитися до інтернету

Перевірте конфігурацію DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Перевірка стану не вдається

Переконайтеся, що сервер дійсно працює:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH-ключ не працює

Переконайтеся у правильних правах на ключі всередині контейнера:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
