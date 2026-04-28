# Как я поднял удаленный `opencode` + `code-server` через Windows Caddy, WSL и свой fork

Это руководство-описание моего рабочего сетапа. Его можно отправлять коллегам как основу для такой же схемы.

Документ не претендует на единственно правильный способ. Это просто проверенная у меня конфигурация, которая оказалась удобной для ежедневной работы.

## TL;DR

Если коротко, схема такая:

1. Домены смотрят на Cloudflare.
2. Cloudflare указывает на статический внешний IP домашнего роутера.
3. На роутере проброшены `80` и `443` на домашний компьютер.
4. На Windows работает Caddy, который публикует сервисы по доменам.
5. Внутри WSL `code-server` слушает `127.0.0.1:8080`.
6. Внутри WSL `opencode` слушает `127.0.0.1:4096`.
7. Caddy проксирует домены на эти локальные порты.
8. `code-server` защищен своим паролем, `opencode` защищен `basic_auth` в Caddy.

Мой минимальный рабочий набор:

- `C:\caddy\caddy.exe`
- `C:\caddy\Caddyfile`
- `code-server` в WSL на `127.0.0.1:8080`
- `opencode-web.service` в WSL
- `/home/futau/opencode-start.sh` для запуска `opencode`

Если нужен именно мой mobile/PWA сценарий, а не просто обычный `OpenCode`, то дополнительно нужны:

- мой fork `hts1238/opencode`
- локальная сборка fork-бинарника
- `OPENCODE_PUSH_VAPID_*`
- при необходимости Windows-side proxy через Hiddify

Если нужен только базовый remote access, то достаточно схемы `Windows Caddy + WSL + code-server + opencode`, а fork-specific части вроде `VAPID` и Web Push можно не повторять.

## Что получается в итоге

На выходе есть такая схема:

- `code-server` доступен по домену вроде `code.example.com`
- `opencode server` доступен по домену вроде `opencode.example.com`
- оба сервиса крутятся внутри WSL
- снаружи их публикует Caddy на Windows
- HTTPS завершает Caddy
- `code-server` сидит за своей штатной парольной формой
- `opencode` сидит за `basic_auth` в Caddy
- если использовать мой fork `opencode`, можно получить удобный mobile/PWA сценарий с Web Push

## Когда такая схема особенно полезна

Эта схема хорошо подходит, если:

- основной рабочий компьютер домашний
- WSL уже используется как основная dev-среда
- нужен доступ к рабочему окружению с ноутбука, телефона или извне
- хочется оставить сами сервисы привязанными к `127.0.0.1`, а наружу отдавать их только через reverse proxy
- нужен стабильный доменный доступ по HTTPS

## Общая архитектура

У меня сейчас это устроено так:

1. Есть домен.
2. NS домена смотрят в Cloudflare.
3. У домашнего роутера у провайдера куплен статический внешний IP.
4. В Cloudflare `A`-записи доменов указывают на внешний IP роутера.
5. На роутере проброшены порты `80` и `443` на домашний компьютер.
6. У домашнего компьютера внутри LAN статический локальный IP.
7. На Windows вне WSL работает Caddy.
8. Внутри WSL работают `code-server` и `opencode`.

Поток трафика:

- Интернет -> внешний IP роутера -> проброс `80/443` -> Windows Caddy
- Windows Caddy -> `127.0.0.1:8080` для `code-server`
- Windows Caddy -> `127.0.0.1:4096` для `opencode`

Это важно: сами сервисы внутри WSL наружу не торчат. Они слушают loopback, а снаружи виден только Caddy.

## Мои конкретные значения

У себя я использую:

- `code.tim-ur.ru` -> `127.0.0.1:8080`
- `opencode.tim-ur.ru` -> `127.0.0.1:4096`
- `code-server` на `127.0.0.1:8080`
- `opencode serve --port 4096`
- Caddy на Windows в `C:\caddy\caddy.exe`
- Caddy-конфиг рядом, в `C:\caddy\Caddyfile`
- локальный checkout форка `opencode` в `/home/futau/opencode`
- рабочий workspace у меня лежит отдельно в WSL
- Windows-side proxy через Hiddify на порту `12334`

Если коллега будет повторять схему у себя, домены, пути и пользовательские имена нужно заменить на свои.

## Шаг 1. Подготовить внешнюю сеть

Минимально нужно:

1. Купить или использовать свой домен.
2. Направить NS домена на Cloudflare.
3. Получить у провайдера статический внешний IP для домашнего роутера.
4. В Cloudflare создать `A`-записи для доменов под `code-server` и `opencode`.
5. На роутере пробросить `80` и `443` на домашний компьютер.
6. На домашнем компьютере закрепить статический локальный IP.

У меня на этом этапе логика такая:

- Cloudflare знает внешний IP роутера
- роутер знает, куда внутри сети слать `80/443`
- Caddy принимает HTTP/HTTPS уже на самой Windows-машине

## Шаг 2. Поднять Caddy на Windows

У меня Caddy установлен максимально просто:

- бинарник лежит в `C:\caddy\caddy.exe`
- конфиг лежит рядом в `C:\caddy\Caddyfile`

Текущая команда перезагрузки конфига у меня такая:

```powershell
C:\caddy\caddy.exe reload --config C:\caddy\Caddyfile
```

Текущий рабочий Caddy-конфиг у меня по сути такой:

```caddy
code.tim-ur.ru {
	reverse_proxy 127.0.0.1:8080
}

opencode.tim-ur.ru {
	basic_auth {
		futau <password_hash>
	}
	reverse_proxy 127.0.0.1:4096
}
```

Для коллег это лучше читать как шаблон:

```caddy
code.example.com {
	reverse_proxy 127.0.0.1:8080
}

opencode.example.com {
	basic_auth {
		username <password_hash>
	}
	reverse_proxy 127.0.0.1:4096
}
```

### Полезные команды Caddy

Сгенерировать хэш пароля для `basic_auth`:

```powershell
C:\caddy\caddy.exe hash-password --plaintext "my-strong-password"
```

Проверить конфиг:

```powershell
C:\caddy\caddy.exe validate --config C:\caddy\Caddyfile
```

Запустить вручную в foreground:

```powershell
C:\caddy\caddy.exe run --config C:\caddy\Caddyfile
```

Перечитать конфиг:

```powershell
C:\caddy\caddy.exe reload --config C:\caddy\Caddyfile
```

### Что у меня не задокументировано до конца

Похоже, у меня Caddy еще и стоит в автозапуске, но точный способ я уже не помню.

Поэтому коллегам я бы советовал не полагаться на память и явно выбрать один из способов автозапуска:

- Планировщик задач Windows
- служба Windows
- ярлык в автозагрузке
- любой другой понятный и воспроизводимый способ

Главное, чтобы было явно понятно:

- откуда стартует `caddy.exe`
- какой `Caddyfile` он читает
- как его перезагрузить после правок

## Шаг 3. Поднять `code-server` внутри WSL

У меня `code-server` поднят через systemd как `code-server@futau.service`.

Главный конфиг:

- `~/.config/code-server/config.yaml`

Ключевые параметры у меня сейчас такие:

```yaml
bind-addr: 127.0.0.1:8080
auth: password
cert: false
```

Смысл такой:

- `code-server` слушает только локально
- HTTPS не делает сам
- снаружи доступ идет через Caddy
- на входе остается штатная парольная форма `code-server`

Полезные команды:

```bash
sudo systemctl enable --now code-server@futau.service
sudo systemctl restart code-server@futau.service
systemctl status code-server@futau.service --no-pager
journalctl -u code-server@futau.service -n 100 --no-pager
journalctl -fu code-server@futau.service
```

Если нужно сделать override юнита, лучше не править package unit, а использовать:

```bash
sudo systemctl edit code-server@futau.service
```

## Шаг 4. Поднять `opencode` внутри WSL

Здесь у меня важный нюанс: я использую не просто upstream `OpenCode`, а свой fork.

Текущие remotes такие:

- `origin = git@github.com:hts1238/opencode.git`
- `upstream = git@github.com:anomalyco/opencode.git`

Текущая рабочая ветка:

- `dev`

### Почему я использую именно fork

Мой fork содержит доработки, которых я не хотел ждать в upstream, и которые важны для личного remote/mobile сценария.

В первую очередь это:

- Web Push для mobile PWA
- управление зарегистрированными push-устройствами
- отдельные настройки уведомлений по устройствам
- улучшения для Android push delivery
- улучшения восстановления веб-сессий после background/resume

Если нужен именно этот опыт, сервис надо запускать из локально собранного fork-бинарника, а не из обычной глобальной установки `opencode`.

### Клонирование и сборка

У меня базовая схема такая:

```bash
git clone git@github.com:hts1238/opencode.git /home/futau/opencode
cd /home/futau/opencode
git remote add upstream git@github.com:anomalyco/opencode.git
git checkout dev
cd /home/futau/opencode/packages/opencode
bun run build
```

После пересборки:

```bash
sudo systemctl restart opencode-web.service
```

Если нужно просто обновить локальный fork и пересобрать:

```bash
git -C /home/futau/opencode pull origin dev
git -C /home/futau/opencode fetch upstream
cd /home/futau/opencode/packages/opencode
bun run build
sudo systemctl restart opencode-web.service
```

## Шаг 5. Оформить `opencode` как systemd-сервис

У меня сервис называется `opencode-web.service`.

Путь к unit-файлу:

- `/etc/systemd/system/opencode-web.service`

Сейчас он выглядит по сути так:

```ini
[Unit]
Description=OpenCode Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=futau
Group=futau
Environment=HOME=/home/futau
WorkingDirectory=/path/to/your/workspace
EnvironmentFile=/etc/opencode/web.env
ExecStart=/home/futau/opencode-start.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Важные идеи тут такие:

- сервис стартует от обычного пользователя, а не от `root`
- рабочая директория сразу указывает на нужный workspace
- реальная логика запуска вынесена в отдельный shell-скрипт
- сервис сам перезапускается после падения

У меня в реальности `WorkingDirectory` указывает на мой основной workspace в WSL. Коллегам тут нужно подставить свой путь.

Команды управления:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now opencode-web.service
sudo systemctl restart opencode-web.service
systemctl status opencode-web.service --no-pager
journalctl -u opencode-web.service -n 100 --no-pager
journalctl -fu opencode-web.service
```

Если надо править unit через override:

```bash
sudo systemctl edit opencode-web.service
```

`daemon-reload` нужен после изменения unit-файла. Если менялся только стартовый скрипт, обычно хватает `restart`.

## Шаг 6. Вынести запуск в отдельный shell-скрипт

У меня сервис не стартует бинарник напрямую, а вызывает `/home/futau/opencode-start.sh`.

Это удобно, потому что в одном месте можно настроить:

- прокси
- `NO_PROXY`
- `VAPID`
- любые fork-specific env
- путь к локальному бинарнику

Упрощенно мой скрипт выглядит так:

```bash
#!/usr/bin/env bash
set -e

HOST_IP=$(ip route | awk '/^default/ {print $3; exit}')
PROXY_PORT=12334

export http_proxy="http://$HOST_IP:$PROXY_PORT"
export https_proxy="$http_proxy"
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$https_proxy"

export NO_PROXY="127.0.0.1,localhost,::1,.local,..."
export no_proxy="$NO_PROXY"

export OPENCODE_PUSH_VAPID_PUBLIC_KEY="<public>"
export OPENCODE_PUSH_VAPID_PRIVATE_KEY="<private>"
export OPENCODE_PUSH_VAPID_SUBJECT="mailto:you@example.com"

export OPENCODE_DISABLE_CHANNEL_DB=1
exec /home/futau/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode serve --port 4096
```

У меня сейчас принципиально важно следующее:

- запускается именно `serve --port 4096`
- используется именно бинарник из локального checkout форка
- старый вариант через `~/.opencode/bin/opencode` у меня закомментирован и не используется

## Шаг 7. Если нужен прокси через Windows Hiddify

У меня на Windows вне WSL поднят Hiddify в режиме proxy.

Из-за этого `opencode-start.sh` делает следующее:

1. Находит Windows host IP внутри WSL через default route.
2. Берет Windows-side proxy порт `12334`.
3. Выставляет `http_proxy`, `https_proxy`, `HTTP_PROXY`, `HTTPS_PROXY`.
4. Оставляет локальные адреса и нужные домены в `NO_PROXY`.

Зачем это нужно:

- чтобы исходящие HTTP/HTTPS запросы `opencode` ходили через Windows-side proxy
- чтобы доступ к внешним API и внешним моделям был стабильнее в моей среде

Если Hiddify не нужен, этот кусок можно убрать.

Если Hiddify нужен, но порт другой, надо поменять `PROXY_PORT` в `opencode-start.sh` и перезапустить сервис.

## Шаг 8. `VAPID` и Web Push

Это тот кусок, который относится именно к fork-specific возможностям.

### Зачем это вообще нужно

`VAPID` нужен для Web Push.

В моем fork-сценарии это дает следующее:

- браузер или PWA может подписаться на push-уведомления сервера
- сервер может отправлять уведомления при завершении сессии или ошибках
- на Android это делает mobile/PWA сценарий реально полезным, а не формально доступным

Если использовать vanilla upstream `OpenCode`, этот раздел можно не повторять.

### Какие переменные нужны

Нужны три переменные:

```bash
OPENCODE_PUSH_VAPID_PUBLIC_KEY
OPENCODE_PUSH_VAPID_PRIVATE_KEY
OPENCODE_PUSH_VAPID_SUBJECT
```

Обычно `OPENCODE_PUSH_VAPID_SUBJECT` задают как `mailto:<email>`.

Пример:

```bash
export OPENCODE_PUSH_VAPID_SUBJECT="mailto:you@example.com"
```

### Как сгенерировать ключи

Простой вариант:

```bash
npx web-push generate-vapid-keys
```

или:

```bash
bunx web-push generate-vapid-keys
```

После генерации нужно перенести значения в окружение.

Пример:

```bash
export OPENCODE_PUSH_VAPID_PUBLIC_KEY="<generated_public_key>"
export OPENCODE_PUSH_VAPID_PRIVATE_KEY="<generated_private_key>"
export OPENCODE_PUSH_VAPID_SUBJECT="mailto:you@example.com"
```

У меня эти значения сейчас лежат прямо в `/home/futau/opencode-start.sh`.

Если хочется сделать чище, их можно убрать в `/etc/opencode/web.env`, потому что unit уже подключает этот файл.

### Как это связано с форком

В моем форке для этого добавлены:

- service worker в `packages/app/public/sw.js`
- API под `/global/push/*`
- хранение push subscriptions на сервере
- логика отправки Web Push
- UI для управления устройствами и push-настройками

Именно поэтому, если нужен такой же опыт, надо использовать именно fork, а не голый upstream.

## Шаг 9. Что важно в конфиге `opencode`

У меня важны два пользовательских файла:

- `~/.config/opencode/opencode.jsonc`
- `~/.config/opencode/opencode.json`

Что там сейчас важно по смыслу:

- серверный порт зафиксирован на `4096`
- настроены дефолтные модели и агенты
- скиллы грузятся из `/home/futau/.codex/skills`
- явно разрешено чтение своего рабочего каталога
- внешние директории `~` и `/tmp` разрешены

Если коллега поднимает свой отдельный workspace, ему надо будет заменить пути на свои.

## Что изменится, если использовать не fork, а обычный upstream

Если использовать обычный upstream `OpenCode`, а не мой fork:

- не нужно настраивать `OPENCODE_PUSH_VAPID_*`
- не нужно ожидать mobile PWA Web Push в такой же схеме
- не будет тех же экранов и API для управления push-устройствами
- не нужно запускать именно локальный fork-бинарник
- не нужно копировать мой стартовый скрипт один в один

Проще говоря:

- схема `WSL + code-server + Windows Caddy + домен + HTTPS` остается полезной и без форка
- а вот `VAPID`, Web Push и mobile/PWA-часть уже относятся именно к fork-specific сценарию

## Что я бы не советовал делать

- не выставлять `code-server` или `opencode` напрямую наружу без reverse proxy
- не слушать сервисы сразу на внешнем интерфейсе, если можно оставить их на `127.0.0.1`
- не путать vanilla upstream и fork-specific настройки
- не переключать `opencode` на глобальный `~/.opencode/bin/opencode`, если нужен именно опыт моего форка
- не хранить секреты в коммитимых файлах
- не забывать перезапускать сервис после изменения стартового скрипта или бинарника

## Полезные команды для повседневной эксплуатации

Проверить сервисы:

```bash
systemctl status code-server@futau.service --no-pager
systemctl status opencode-web.service --no-pager
```

Проверить порты:

```bash
ss -lntp '( sport = :8080 or sport = :4096 )'
```

Посмотреть логи:

```bash
journalctl -u code-server@futau.service -n 100 --no-pager
journalctl -u opencode-web.service -n 100 --no-pager
```

Проверить git-состояние форка:

```bash
git -C /home/futau/opencode remote -v
git -C /home/futau/opencode branch --show-current
```

Перезагрузить Caddy после правки конфига:

```powershell
C:\caddy\caddy.exe reload --config C:\caddy\Caddyfile
```

## Короткий checklist для повторения

1. Подготовить домен, Cloudflare, статический внешний IP и проброс `80/443`.
2. Поднять Caddy на Windows и проверить, что он публикует `code-server` и `opencode` по доменам.
3. Поднять `code-server` в WSL на `127.0.0.1:8080`.
4. Если нужен мой mobile/PWA сценарий, клонировать именно fork `hts1238/opencode`.
5. Собрать локальный fork-бинарник `opencode`.
6. Создать `opencode-web.service`, который запускает `opencode-start.sh`.
7. В `opencode-start.sh` настроить порт, прокси и при необходимости `VAPID`.
8. Если нужен Windows-side proxy, настроить Hiddify и указать его порт.
9. Проверить `https://code.<ваш-домен>` и `https://opencode.<ваш-домен>`.

## Итог

Для меня эта схема оказалась удобной потому, что она сочетает:

- простой внешний HTTPS через Caddy
- безопасную публикацию только через reverse proxy
- привычную разработку внутри WSL
- удаленный доступ к `code-server`
- удаленный доступ к `opencode`
- и, в случае моего fork-а, нормальный mobile/PWA опыт с push-уведомлениями

Если повторять ее у себя, я бы советовал разделять две вещи:

- базовая схема публикации сервисов через Windows Caddy и WSL
- fork-specific надстройки вроде `VAPID`, Web Push и mobile/PWA-улучшений

Так проще понять, что обязательно всем, а что нужно только тем, кто хочет повторить именно мой личный сценарий использования.
