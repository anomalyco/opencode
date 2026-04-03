# OpenCode 환경 안내

## 컨테이너 환경

- `python3`만 설치되어 있습니다. `python` 명령어는 없습니다.
- `curl`, `wget`은 설치되어 있지 않습니다. HTTP 요청 테스트는 `python3 -c "import urllib.request; ..."` 를 사용하세요.

## 결과물 서빙

port 8888은 OpenCode 웹 UI가 사용 중입니다. 결과물 서빙에는 port 3000을 사용하세요.

컨테이너의 port 3000에서 HTTP 서버를 실행하면, 외부에서 접근할 수 있습니다.

접근 주소의 환경변수 `$OPENCODE_HUB_HOST`와 `$JUPYTERHUB_USER`를 반드시 셸에서 실행하여 실제 값으로 치환한 뒤 사용자에게 안내하세요. 환경변수를 그대로 노출하지 마세요.

```bash
echo "https://$OPENCODE_HUB_HOST/serve/$JUPYTERHUB_USER/"
```

### 예시

정적 파일 서빙:

```bash
cd /home/jovyan/project
python3 -m http.server 3000
```

Node.js 앱:

```bash
PORT=3000 node app.js
```
