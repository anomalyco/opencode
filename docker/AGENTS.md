# OpenCode 환경 안내

## 결과물 서빙

port 8888은 OpenCode 웹 UI가 사용 중입니다. 결과물 서빙에는 port 3000을 사용하세요.

컨테이너의 port 3000에서 HTTP 서버를 실행하면, 외부에서 접근할 수 있습니다.

접근 주소:

```
https://opencode.dev.team-mono.com/serve/{username}/
```

`{username}`은 환경변수 `$JUPYTERHUB_USER`에서 확인할 수 있습니다.

### 예시

정적 파일 서빙:

```bash
cd /home/jovyan/project
python -m http.server 3000
```

Node.js 앱:

```bash
PORT=3000 node app.js
```

서버를 실행한 뒤, `https://opencode.dev.team-mono.com/serve/$JUPYTERHUB_USER/` 에서 결과를 확인합니다.
