# OpenCode 환경 안내

## 결과물 서빙

port 8888은 OpenCode 웹 UI가 사용 중입니다. 결과물 서빙에는 port 3000을 사용하세요.

컨테이너의 port 3000에서 HTTP 서버를 실행하면, 아래 주소로 외부에서 접근할 수 있습니다.

```
https://$OPENCODE_HUB_HOST/serve/$JUPYTERHUB_USER/
```

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
