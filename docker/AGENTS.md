# OpenCode 환경 안내

## 보안 규칙

- API 키, 시크릿, 토큰을 출력하거나 저장하지 마세요.
- `env`, `printenv`, `set` 등 환경변수 전체를 출력하는 명령을 실행하지 마세요.
- 환경변수 값을 파일에 기록하거나 외부로 전송하지 마세요.

## 컨테이너 환경

- `python3`만 설치되어 있습니다. `python` 명령어는 없습니다.
- `curl`, `wget`, `jq`, `make`, `zip`, `unzip`, `less`, `ps` 등 기본 리눅스 명령어를 사용할 수 있습니다.
- 추가 패키지가 필요하면 `apt-get update && apt-get install -y <패키지명>` 으로 설치할 수 있습니다.

## Python 가상환경 (uv)

Python 패키지 설치 시 반드시 uv로 가상환경을 만들어 사용하세요.

```bash
cd ~/project
uv venv .venv
source .venv/bin/activate
uv pip install flask  # 예시
```

일회성 실행은 uvx를 사용하세요.

```bash
uvx ruff check .
```

## Node.js 패키지 (npx)

Node.js 패키지를 설치 없이 실행하려면 npx를 사용하세요.

```bash
npx create-react-app my-app
npx serve -l 3000 ./dist
```

프로젝트에 패키지를 설치하려면 npm을 사용하세요.

```bash
cd ~/project
npm init -y
npm install express
```

## 결과물 서빙

port 8888은 OpenCode 웹 UI가 사용 중입니다. 결과물 서빙에는 port 3000을 사용하세요.

컨테이너의 port 3000에서 HTTP 서버를 실행하면, 외부에서 접근할 수 있습니다.

접근 주소의 환경변수 `$JUPYTERHUB_USER`와 `$OPENCODE_SERVE_DOMAIN`을 반드시 셸에서 실행하여 실제 값으로 치환한 뒤 사용자에게 안내하세요. 환경변수를 그대로 노출하지 마세요.

```bash
echo "https://$JUPYTERHUB_USER.$OPENCODE_SERVE_DOMAIN/"
```

### 예시

정적 파일 서빙:

```bash
cd ~/project
python3 -m http.server 3000
```

Node.js 앱:

```bash
PORT=3000 node app.js
```

## 미리보기 갱신

학생은 응답이 끝날 때마다 미리보기 화면에서 결과의 변화를 확인합니다. 미리보기 패널은 파일 변경을 감지하면 자동으로 다시 로드하므로, 학생에게 새로고침을 시키지 마세요. 다만 서버가 "디스크의 최신 내용을 응답할 수 있는 상태" 여야 자동 리로드가 의미가 있습니다.

이 환경에서는 dev 서버의 핫 리로드(HMR)나 파일 감시가 안정적이지 않으므로, **dev 서버 캐시에 의존하지 말고 정적 서빙을 우선**하세요.

### 권장 구성

- 단순 HTML/CSS/JS 결과물 — 정적 서버를 한 번만 띄워두면 됩니다. 매 요청마다 디스크에서 직접 읽어 최신 내용을 반환합니다.
  ```bash
  cd ~/project
  npx --yes serve -l 3000 . &
  ```
- Vite/Next/CRA 등 빌드 도구를 쓰는 결과물 — 파일을 수정한 턴마다 `dist` 를 새로 빌드하고 정적 서빙하세요. `npm run dev` 의 HMR 은 이 환경에서 변경을 놓치므로 사용하지 마세요.
  ```bash
  cd ~/project
  npm run build && (pkill -f "serve -l 3000" 2>/dev/null; npx --yes serve -l 3000 ./dist &)
  ```
  첫 빌드 후에는 캐시 덕에 보통 수 초 안에 끝납니다.
- 이미 떠 있는 서버가 있는지는 `ps -ef | grep -E "serve|http.server|vite|next"` 로 확인할 수 있습니다. 같은 포트에 중복 spawn 하지 마세요.

### 응답을 마무리할 때

수정을 마쳤다면 무엇이 바뀌었는지 1-3줄로 짧게 설명합니다. 미리보기는 자동으로 갱신되므로 매 응답마다 "오른쪽을 보세요" 같은 안내를 반복할 필요는 없습니다.

미리보기가 비어 있거나 옛날 화면으로 보인다고 학생이 보고하면, 학생에게 떠넘기지 말고 아래 "브라우저 디버깅" 워크플로로 직접 원인을 확인합니다.

## 브라우저 디버깅

사용자가 앱이 동작하지 않는다고 보고하면, Playwright MCP 도구로 직접 확인하세요.

### 워크플로

1. 서빙 주소를 확인합니다.
```bash
echo "http://localhost:3000"
```
2. `browser_navigate`로 페이지에 접속합니다.
3. `browser_console_messages`로 콘솔 에러를 확인합니다.
4. `browser_network_requests`로 실패한 네트워크 요청을 확인합니다.
5. 필요하면 `browser_take_screenshot`으로 시각적 상태를 확인합니다.
6. 원인을 파악하고 코드를 수정합니다.

### 사용 가능한 도구

- `browser_navigate` - URL로 이동
- `browser_console_messages` - 콘솔 로그/에러 조회
- `browser_network_requests` - 네트워크 요청/응답 조회
- `browser_take_screenshot` - 페이지 스크린샷 캡처
- `browser_evaluate` - JavaScript 실행
- `browser_snapshot` - 페이지 구조(접근성 트리) 조회
- `browser_click` - 페이지 요소 클릭
- `browser_fill_form` - 폼 입력
