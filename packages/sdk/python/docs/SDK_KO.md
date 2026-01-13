# Python SDK

OpenCode 서버를 위한 타입 안전한 Python 클라이언트입니다.

OpenCode Python SDK는 서버와 상호작용하기 위한 타입 안전한 클라이언트를 제공합니다. 통합 시스템을 구축하고 OpenCode를 프로그래밍 방식으로 제어할 수 있습니다.

---

## 설치

PyPI에서 SDK를 설치합니다:

```bash
pip install opencode-sdk
```

---

## 클라이언트 생성

OpenCode 인스턴스를 생성합니다:

```python
from opencode_sdk import create_opencode

opencode = create_opencode()
client = opencode.client
```

이렇게 하면 서버와 클라이언트가 함께 시작됩니다.

### 옵션

| 옵션       | 타입     | 설명                    | 기본값      |
| ---------- | -------- | ----------------------- | ----------- |
| `hostname` | `str`    | 서버 호스트네임         | `127.0.0.1` |
| `port`     | `int`    | 서버 포트               | `4096`      |
| `timeout`  | `float`  | 서버 시작 타임아웃 (초) | `5.0`       |
| `config`   | `Config` | 설정 객체               | `None`      |

---

## 설정

동작을 커스터마이즈하기 위해 설정 객체를 전달할 수 있습니다:

```python
from opencode_sdk import create_opencode

opencode = create_opencode(
    hostname="127.0.0.1",
    port=4096,
    config={"model": "anthropic/claude-3-5-sonnet-20241022"},
)

print(f"서버 실행 중: {opencode.server.url}")
opencode.close()
```

---

## 비동기 사용법

비동기 애플리케이션의 경우:

```python
import asyncio
from opencode_sdk import create_opencode_async

async def main():
    opencode = await create_opencode_async()
    client = opencode.client

    # 비동기 메서드 사용
    sessions = await client.session.list_async()

    await opencode.aclose()

asyncio.run(main())
```

---

## 클라이언트만 사용

이미 실행 중인 OpenCode 인스턴스가 있다면, 클라이언트를 생성하여 연결합니다:

```python
from opencode_sdk import create_opencode_client

client = create_opencode_client(base_url="http://localhost:4096")
```

### 옵션

| 옵션        | 타입    | 설명                     | 기본값                  |
| ----------- | ------- | ------------------------ | ----------------------- |
| `base_url`  | `str`   | 서버 URL                 | `http://127.0.0.1:4096` |
| `timeout`   | `float` | 요청 타임아웃 (초)       | `None`                  |
| `headers`   | `dict`  | 추가 헤더                | `{}`                    |
| `directory` | `str`   | 인스턴스의 기본 디렉토리 | `None`                  |

---

## 타입

SDK는 모든 API 타입에 대한 타입 정의를 포함합니다. 직접 import하여 사용할 수 있습니다:

```python
from opencode_sdk import Session, Message, Part, Config
```

모든 타입은 [types 파일](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/python/opencode_sdk/types.py)에 TypedDict 클래스로 정의되어 있습니다.

---

## 응답 처리

모든 API 메서드는 `ok`, `data`, `error` 속성을 가진 `Response` 객체를 반환합니다:

```python
response = client.session.list()

if response.ok:
    sessions = response.data
    for session in sessions:
        print(session["id"], session["title"])
else:
    print(f"에러: {response.error}")
```

---

## API

SDK는 타입 안전한 클라이언트를 통해 모든 서버 API를 제공합니다.

---

### App

| 메서드                             | 설명                           | 응답      |
| ---------------------------------- | ------------------------------ | --------- |
| `app.log(service, level, message)` | 로그 항목 작성                 | `bool`    |
| `app.agents()`                     | 사용 가능한 모든 에이전트 목록 | `Agent[]` |

#### 예제

```python
# 로그 항목 작성
client.app.log(service="my-app", level="info", message="작업 완료")

# 사용 가능한 에이전트 목록
agents = client.app.agents()
if agents.ok:
    for agent in agents.data:
        print(agent["name"])
```

---

### Project

| 메서드              | 설명                   | 응답        |
| ------------------- | ---------------------- | ----------- |
| `project.list()`    | 모든 프로젝트 목록     | `Project[]` |
| `project.current()` | 현재 프로젝트 가져오기 | `Project`   |

#### 예제

```python
# 모든 프로젝트 목록
projects = client.project.list()

# 현재 프로젝트 가져오기
current = client.project.current()
if current.ok:
    print(current.data["path"])
```

---

### Path

| 메서드       | 설명               | 응답       |
| ------------ | ------------------ | ---------- |
| `path.get()` | 현재 경로 가져오기 | `PathInfo` |

#### 예제

```python
path_info = client.path.get()
if path_info.ok:
    print(path_info.data)
```

---

### Config

| 메서드               | 설명                         | 응답                   |
| -------------------- | ---------------------------- | ---------------------- |
| `config.get()`       | 설정 정보 가져오기           | `Config`               |
| `config.providers()` | 프로바이더 및 기본 모델 목록 | `ProviderListResponse` |

#### 예제

```python
config = client.config.get()

providers = client.config.providers()
if providers.ok:
    for provider in providers.data["providers"]:
        print(provider["name"])
```

---

### Sessions

| 메서드                                                    | 설명                        | 응답                        |
| --------------------------------------------------------- | --------------------------- | --------------------------- |
| `session.list()`                                          | 세션 목록                   | `Session[]`                 |
| `session.get(id)`                                         | 세션 가져오기               | `Session`                   |
| `session.children(id)`                                    | 하위 세션 목록              | `Session[]`                 |
| `session.create(title, parent_id)`                        | 세션 생성                   | `Session`                   |
| `session.delete(id)`                                      | 세션 삭제                   | `bool`                      |
| `session.update(id, title)`                               | 세션 속성 업데이트          | `Session`                   |
| `session.init(id, ...)`                                   | 앱 분석 및 `AGENTS.md` 생성 | `bool`                      |
| `session.abort(id)`                                       | 실행 중인 세션 중단         | `bool`                      |
| `session.share(id)`                                       | 세션 공유                   | `Session`                   |
| `session.unshare(id)`                                     | 세션 공유 해제              | `Session`                   |
| `session.summarize(id, ...)`                              | 세션 요약                   | `bool`                      |
| `session.messages(id, limit)`                             | 세션의 메시지 목록          | `MessageWithParts[]`        |
| `session.message(id, message_id)`                         | 메시지 상세 정보            | `MessageWithParts`          |
| `session.prompt(id, parts, ...)`                          | 프롬프트 메시지 전송        | `AssistantMessageWithParts` |
| `session.command(id, command, arguments)`                 | 세션에 명령어 전송          | `AssistantMessageWithParts` |
| `session.shell(id, agent, command)`                       | 셸 명령어 실행              | `AssistantMessageWithParts` |
| `session.revert(id, message_id)`                          | 메시지 되돌리기             | `Session`                   |
| `session.unrevert(id)`                                    | 되돌린 메시지 복원          | `Session`                   |
| `session.permission_respond(id, permission_id, response)` | 권한 요청에 응답            | `bool`                      |

#### 예제

```python
# 세션 생성 및 관리
session = client.session.create(title="내 세션")
if session.ok:
    session_id = session.data["id"]

sessions = client.session.list()

# 프롬프트 메시지 전송
result = client.session.prompt(
    session_id,
    parts=[{"type": "text", "text": "안녕하세요!"}],
    model={"providerID": "anthropic", "modelID": "claude-3-5-sonnet-20241022"},
)

if result.ok:
    for part in result.data["parts"]:
        if part.get("type") == "text":
            print(part["text"])

# AI 응답 없이 컨텍스트만 주입 (플러그인에 유용)
client.session.prompt(
    session_id,
    parts=[{"type": "text", "text": "당신은 도움이 되는 어시스턴트입니다."}],
    no_reply=True,
)

# 세션 삭제
client.session.delete(session_id)
```

---

### Files

| 메서드                           | 설명                           | 응답           |
| -------------------------------- | ------------------------------ | -------------- |
| `find.text(pattern)`             | 파일에서 텍스트 검색           | `FindMatch[]`  |
| `find.files(query, dirs, limit)` | 이름으로 파일 및 디렉토리 찾기 | `str[]`        |
| `find.symbols(query)`            | 워크스페이스 심볼 찾기         | `Symbol[]`     |
| `file.read(path)`                | 파일 읽기                      | `FileContent`  |
| `file.list(path)`                | 디렉토리의 파일 목록           | `FileNode[]`   |
| `file.status()`                  | 추적된 파일의 상태 가져오기    | `FileStatus[]` |

#### 예제

```python
# 파일에서 텍스트 검색
results = client.find.text(pattern="def.*opencode")

# 파일 찾기
files = client.find.files(query="*.py")
if files.ok:
    for path in files.data:
        print(path)

# 디렉토리 찾기
dirs = client.find.files(query="packages", dirs=True, limit=20)

# 파일 읽기
content = client.file.read(path="src/main.py")
if content.ok:
    print(content.data["content"])
```

---

### TUI

| 메서드                                              | 설명                   | 응답   |
| --------------------------------------------------- | ---------------------- | ------ |
| `tui.append_prompt(text)`                           | 프롬프트에 텍스트 추가 | `bool` |
| `tui.open_help()`                                   | 도움말 다이얼로그 열기 | `bool` |
| `tui.open_sessions()`                               | 세션 선택기 열기       | `bool` |
| `tui.open_themes()`                                 | 테마 선택기 열기       | `bool` |
| `tui.open_models()`                                 | 모델 선택기 열기       | `bool` |
| `tui.submit_prompt()`                               | 현재 프롬프트 제출     | `bool` |
| `tui.clear_prompt()`                                | 프롬프트 지우기        | `bool` |
| `tui.execute_command(command)`                      | 명령어 실행            | `bool` |
| `tui.show_toast(message, variant, title, duration)` | 토스트 알림 표시       | `bool` |

#### 예제

```python
# TUI 인터페이스 제어
client.tui.append_prompt(text="프롬프트에 추가할 내용")

client.tui.show_toast(message="작업 완료", variant="success")
```

---

### Auth

| 메서드               | 설명                | 응답   |
| -------------------- | ------------------- | ------ |
| `auth.set(id, auth)` | 인증 자격 증명 설정 | `bool` |

#### 예제

```python
client.auth.set(
    id="anthropic",
    auth={"type": "api", "key": "your-api-key"},
)
```

---

### Events

| 메서드              | 설명                    | 응답                 |
| ------------------- | ----------------------- | -------------------- |
| `event.subscribe()` | 서버 전송 이벤트 스트림 | `Iterator[SseEvent]` |

#### 예제

```python
# 실시간 이벤트 수신 (동기)
for event in client.event.subscribe():
    print(f"이벤트: {event.event}, 데이터: {event.data}")

# 비동기 버전
async for event in client.event.subscribe_async():
    print(f"이벤트: {event.event}, 데이터: {event.data}")
```

---

### MCP (Model Context Protocol)

| 메서드                          | 설명                              | 응답             |
| ------------------------------- | --------------------------------- | ---------------- |
| `mcp.status()`                  | MCP 서버 상태 가져오기            | `McpStatus`      |
| `mcp.add(name, config)`         | MCP 서버 동적 추가                | `bool`           |
| `mcp.connect(name)`             | MCP 서버 연결                     | `bool`           |
| `mcp.disconnect(name)`          | MCP 서버 연결 해제                | `bool`           |
| `mcp.auth.start(name)`          | OAuth 플로우 시작                 | `str` (인증 URL) |
| `mcp.auth.callback(name, code)` | 코드로 OAuth 완료                 | `bool`           |
| `mcp.auth.authenticate(name)`   | 전체 OAuth 플로우 (브라우저 열림) | `bool`           |
| `mcp.auth.remove(name)`         | OAuth 자격 증명 제거              | `bool`           |

#### 예제

```python
# MCP 서버 추가 및 연결
client.mcp.add(
    name="my-mcp",
    config={"type": "local", "command": "npx", "args": ["-y", "my-mcp-server"]},
)
client.mcp.connect("my-mcp")

# 상태 확인
status = client.mcp.status()
if status.ok:
    for server in status.data["servers"]:
        print(f"{server['name']}: {server['status']}")

# 연결 해제
client.mcp.disconnect("my-mcp")
```

---

### Provider

| 메서드                                      | 설명                          | 응답                   |
| ------------------------------------------- | ----------------------------- | ---------------------- |
| `provider.list()`                           | 모든 프로바이더 목록          | `Provider[]`           |
| `provider.auth()`                           | 프로바이더 인증 방법 가져오기 | `ProviderAuthMethod[]` |
| `provider.oauth.authorize(id, method)`      | OAuth 인증 시작               | `str` (인증 URL)       |
| `provider.oauth.callback(id, method, code)` | OAuth 콜백 완료               | `bool`                 |

#### 예제

```python
# 프로바이더 목록
providers = client.provider.list()
if providers.ok:
    for provider in providers.data:
        print(provider["id"], provider["name"])

# 인증 방법 가져오기
auth_methods = client.provider.auth()
```

---

### PTY (가상 터미널)

| 메서드                                  | 설명                   | 응답    |
| --------------------------------------- | ---------------------- | ------- |
| `pty.list()`                            | 모든 PTY 세션 목록     | `Pty[]` |
| `pty.create(command, args, cwd, title)` | PTY 세션 생성          | `Pty`   |
| `pty.get(id)`                           | PTY 세션 정보 가져오기 | `Pty`   |
| `pty.remove(id)`                        | PTY 세션 제거          | `bool`  |
| `pty.update(id, title, size)`           | PTY 세션 업데이트      | `Pty`   |
| `pty.connect(id)`                       | PTY 세션에 연결        | `bool`  |

#### 예제

```python
# PTY 세션 생성
pty = client.pty.create(command="bash", args=["-l"], title="내 터미널")
if pty.ok:
    pty_id = pty.data["id"]

# PTY 세션 목록
sessions = client.pty.list()

# PTY 세션 제거
client.pty.remove(pty_id)
```

---

### LSP & Formatter

| 메서드               | 설명                   | 응답              |
| -------------------- | ---------------------- | ----------------- |
| `lsp.status()`       | LSP 서버 상태 가져오기 | `LspStatus`       |
| `formatter.status()` | 포매터 상태 가져오기   | `FormatterStatus` |

#### 예제

```python
# LSP 상태 확인
lsp_status = client.lsp.status()
if lsp_status.ok:
    for server in lsp_status.data.get("servers", []):
        print(f"{server['name']}: {server['status']}")

# 포매터 상태 확인
formatter_status = client.formatter.status()
```

---

### VCS (버전 관리)

| 메서드      | 설명                              | 응답      |
| ----------- | --------------------------------- | --------- |
| `vcs.get()` | 현재 인스턴스의 VCS 정보 가져오기 | `VcsInfo` |

#### 예제

```python
vcs = client.vcs.get()
if vcs.ok:
    print(f"브랜치: {vcs.data.get('branch')}")
    print(f"변경사항 있음: {vcs.data.get('dirty')}")
```

---

## 전체 예제

```python
from opencode_sdk import create_opencode

# 서버와 클라이언트 시작
opencode = create_opencode()
client = opencode.client

try:
    # 세션 생성
    session = client.session.create(title="내 채팅")
    if not session.ok:
        print(f"세션 생성 실패: {session.error}")
        exit(1)

    session_id = session.data["id"]
    print(f"세션 생성됨: {session_id}")

    # 프롬프트 전송
    response = client.session.prompt(
        session_id,
        parts=[{"type": "text", "text": "Python이란 무엇인가요?"}],
    )

    if response.ok:
        for part in response.data["parts"]:
            if part.get("type") == "text":
                print(f"어시스턴트: {part['text']}")

    # 모든 세션 목록
    sessions = client.session.list()
    if sessions.ok:
        print(f"\n총 세션 수: {len(sessions.data)}")

finally:
    # 정리
    opencode.close()
```

---

## 비동기 전체 예제

```python
import asyncio
from opencode_sdk import create_opencode_async

async def main():
    opencode = await create_opencode_async()
    client = opencode.client

    try:
        # 세션 생성
        session = await client.session.create_async(title="비동기 채팅")
        if not session.ok:
            print(f"실패: {session.error}")
            return

        session_id = session.data["id"]

        # 프롬프트 전송
        response = await client.session.prompt_async(
            session_id,
            parts=[{"type": "text", "text": "안녕하세요!"}],
        )

        if response.ok:
            for part in response.data["parts"]:
                if part.get("type") == "text":
                    print(part["text"])

    finally:
        await opencode.aclose()

asyncio.run(main())
```
