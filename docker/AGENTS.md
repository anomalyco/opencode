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
