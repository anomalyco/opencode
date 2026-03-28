# OpenCode 서버 Docker 문서

이 가이드에서는 Docker 컨테이너에서 서버 모드로 OpenCode를 실행하는 방법을 설명합니다.

## 소개

OpenCode 서버는 백그라운드 서비스로 실행되며 HTTP API를 통해 액세스할 수 있는 OpenCode의 헤드리스 배포입니다. Docker 이미지는 모든 필수 도구가 사전 설치된 완전한 런타임 환경을 제공하며, 다음에 이상적입니다:

- 원격 개발 환경
- CI/CD 통합
- 팀 공유 코딩 인스턴스
- GUI가 없는 서버에서 OpenCode 실행

## 빠른 시작

안전한 비밀번호로 OpenCode 서버를 실행합니다:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

`http://localhost:3000`에서 서버에 액세스합니다.

## 이미지 변형

두 가지 기본 이미지 변형을 사용할 수 있습니다:

| 변형     | 기본 이미지        | 크기   | 사용 사례                   |
| -------- | ------------------ | ------ | --------------------------- |
| `debian` | Debian Trixie Slim | ~500MB | 대부분의 사용자에게 권장    |
| `alpine` | Alpine Edge        | ~200MB | 최소 공간, 더 빠른 다운로드 |

### 특정 변형 다운로드

```bash
# Debian (권장)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (최소)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## 환경 변수

| 변수                       | 기본값                        | 설명                               |
| -------------------------- | ----------------------------- | ---------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (없음)                        | **필수.** HTTP Basic 인증 비밀번호 |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | HTTP Basic 인증 사용자 이름        |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | 구성 디렉토리                      |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | 캐시 디렉토리                      |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | 데이터 디렉토리                    |

### 서버 옵션 (CLI 플래그)

기본 명령을 재정의할 때 서버는 다음 추가 옵션을 허용합니다:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| 플래그          | 기본값           | 설명                         |
| --------------- | ---------------- | ---------------------------- |
| `--port`        | `0` (무작위)     | 수신 대기 포트               |
| `--hostname`    | `127.0.0.1`      | 바인딩할 호스트명            |
| `--mdns`        | `false`          | mDNS 서비스 검색 활성화      |
| `--mdns-domain` | `opencode.local` | 사용자 정의 mDNS 도메인 이름 |
| `--cors`        | `[]`             | 추가 CORS 허용 도메인        |

## 볼륨 마운트

데이터를 지속하고 리소스를 공유하려면 다음 볼륨을 마운트합니다:

### 작업 영역 (필수)

```bash
-v /path/to/workspace:/workspace
```

여기에서 OpenCode가 프로젝트 파일을 작업합니다. 코드 저장소를 여기에 마운트합니다.

### SSH 키

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

비공개 저장소를克隆하기 위한 SSH 키에 대한 읽기 전용 액세스입니다.

### Git 구성

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

호스트에서 Git 사용자 ID를 상속합니다.

### OpenCode 구성

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

컨테이너 재시작 간 OpenCode 설정을 유지합니다.

### 캐시

```bash
-v opencode_cache:/home/opencode/.cache
```

npm 패키지, 언어 서버 및 기타 다운로드한 도구를 캐시합니다.

## 포트

| 포트   | 프로토콜 | 설명          |
| ------ | -------- | ------------- |
| `3000` | HTTP     | 기본 서버 API |

Docker의 `-p` 플래그로 포트를 다시 매핑할 수 있습니다:

```bash
-p 8080:3000  # http://localhost:8080에서 서버에 액세스
```

## 사용자 및 권한

보안을 위해 컨테이너는 비루트 사용자(`opencode`, UID 1000)로 실행됩니다. 이 사용자는 관리 작업에 비밀번호 없는 `sudo` 액세스 권한이 있습니다:

```bash
# opencode 사용자로 명령 실행
docker exec -it opencode-server sudo -u opencode <command>

# opencode 사용자의 셸 가져오기
docker exec -it opencode-server sudo -u opencode /bin/bash
```

루트 액세스가 필요한 경우:

```bash
docker exec -it opencode-server /bin/bash
```

## 설치된 도구

이미지에는 다음 도구가 기본적으로 포함되어 있습니다:

| 도구              | 설명                               |
| ----------------- | ---------------------------------- |
| `opencode`        | OpenCode CLI                       |
| `bun`             | JavaScript 런타임 및 패키지 관리자 |
| `bunx`            | npx의 Bun 버전 (npm 패키지 실행)   |
| `uv`              | Python 패키지 관리자               |
| `git`             | 버전 관리                          |
| `git-lfs`         | Git의 대용량 파일 저장소 확장      |
| `build-essential` | GCC, make 및 빌드 라이브러리       |
| `curl`            | HTTP 클라이언트                    |
| `wget`            | 파일 다운로드 유틸리티             |
| `openssh-client`  | SSH 클라이언트 및 키 도구          |
| `xz-utils`        | 압축 유틸리티                      |

### bun 사용

```bash
# Node.js 패키지 실행
docker exec -it opencode-server bunx create-next-app

# 의존성 설치
docker exec -it opencode-server bun install
```

### uv 사용

```bash
# Python 패키지 설치
docker exec -it opencode-server uv pip install pandas

# Python 스크립트 실행
docker exec -it opencode-server uv run script.py
```

### git 사용

```bash
# 저장소를 작업 영역에 클론
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## 상태 확인

컨테이너에는 서버가 응답하는지 확인하는 내장 상태 확인이 포함되어 있습니다:

```bash
# 컨테이너 상태 확인
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

상태 엔드포인트는 정상일 때 HTTP 200을 반환합니다:

```bash
# 수동 상태 확인
curl -f http://localhost:3000/health
```

상태 확인 구성:

- 간격: 30초
- 시간 초과: 10초
- 시작 기간: 10초
- 재시도: 3회

## Docker Compose 예시

`docker-compose.yml` 파일을 생성합니다:

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

스택을 시작합니다:

```bash
docker-compose up -d
```

## 소스에서 빌드

소스에서 서버 이미지를 빌드합니다:

### 저장소 클론

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Debian 변형 빌드

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Alpine 변형 빌드

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### 로컬 빌드 실행

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## 문제 해결

### 서버가 시작되지 않음

로그를 확인합니다:

```bash
docker logs opencode-server
```

일반적인 문제:

- `OPENCODE_SERVER_PASSWORD` 누락 - 서버가 인증 없이 시작을 거부함
- 포트가 이미 사용 중 - 호스트 포트 매핑 변경

### 인증 실패

비밀번호가 정확히 일치하는지 확인합니다. 서버는 HTTP Basic Auth를 사용합니다:

```bash
# 인증 테스트
curl -u opencode:your_password http://localhost:3000/health
```

### 작업 영역 권한 오류

마운트된 디렉토리가 UID 1000에서 쓰기 가능한지 확인합니다:

```bash
# 소유권 수정
sudo chown -R 1000:1000 /path/to/workspace
```

### 시작이 느림

첫 실행 시 언어 서버와 도구를 다운로드합니다. 진행 상황을 확인합니다:

```bash
docker logs -f opencode-server
```

### 컨테이너가 인터넷에 연결할 수 없음

DNS 구성을 확인합니다:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### 상태 확인 실패

서버가 실제로 실행 중인지 확인합니다:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH 키가 작동하지 않음

컨테이너 내 키 권한이 올바른지 확인합니다:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
