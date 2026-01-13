# OpenCode 폐쇄망 모드 (Offline Mode)

이 문서는 폐쇄망 환경에서 OpenCode를 실행하는 방법을 설명합니다.

## 개요

이 포크는 폐쇄망(인터넷 연결이 차단된 환경)에서 OpenCode를 완벽하게 작동시키기 위해 수정되었습니다. 주요 변경사항:

- 모든 외부 네트워크 요청에 타임아웃 추가 (2-5초)
- `OPENCODE_OFFLINE_MODE` 환경 변수 추가
- 오프라인 모드에서 자동으로 네트워크 기능 비활성화

## 주요 수정 사항

### 1. 타임아웃이 추가된 네트워크 호출

다음 네트워크 호출들에 타임아웃이 추가되어 폐쇄망에서 무한 대기를 방지합니다:

- **Installation.latest()** - 버전 업데이트 체크 (3초 타임아웃)
- **원격 설정 로드** - `.well-known/opencode` 엔드포인트 (2초 타임아웃)
- **모델 정보 로드** - `models.dev` API (2초 타임아웃)
- **Share 기능** - 세션 공유 기능 (오프라인 모드에서 완전 비활성화)
- **Import 기능** - URL을 통한 세션 import (5초 타임아웃)

### 2. 폐쇄망 모드에서 자동 비활성화되는 기능

`OPENCODE_OFFLINE_MODE=1` 설정 시 다음 기능들이 자동으로 비활성화됩니다:

- LSP 서버 자동 다운로드
- 모델 정보 자동 fetch
- 자동 업데이트 체크
- Share 기능 (세션 공유)
- 원격 설정 로드

## 사용 방법

### 1. 환경 준비 (인터넷 연결 환경)

```bash
# 1. 프로젝트 클론 및 의존성 설치
git clone <repository-url>
cd my-opencode
npm install

# 2. 빌드
npm run build

# 3. 전체 프로젝트 디렉토리를 폐쇄망으로 복사
# node_modules와 모든 빌드 결과물을 포함
```

### 2. 폐쇄망 환경 설정

#### 환경 변수 설정

`.bashrc` 또는 `.zshrc`에 다음 환경 변수를 추가:

```bash
# 필수: 폐쇄망 모드 활성화
export OPENCODE_OFFLINE_MODE=1

# 필수: 자체 LLM API 엔드포인트 설정
export ANTHROPIC_API_KEY="your-api-key"
export ANTHROPIC_BASE_URL="http://your-internal-llm-api.com/v1"

# 선택: 로컬 모델 정보 파일 경로 (있는 경우)
export MODELS_DEV_API_JSON="/path/to/local/models.json"

# 선택: OpenCode API 엔드포인트 (내부망 API 사용 시)
export OPENCODE_API="http://your-internal-opencode-api.com"
```

#### OpenCode 설정 파일

`~/.config/opencode/opencode.jsonc` 생성:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // 자체 LLM 프로바이더 설정
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "your-api-key",
        "baseURL": "http://your-internal-llm-api.com/v1"
      }
    }
  },

  // 기본 모델 설정
  "model": "anthropic/claude-3-5-sonnet-20241022",

  // Share 기능 비활성화 (오프라인 모드에서는 자동 비활성화됨)
  "share": "disabled",

  // LSP 서버 자동 다운로드 비활성화 (오프라인 모드에서는 자동 비활성화됨)
  "lsp": false,

  // 자동 업데이트 비활성화 (오프라인 모드에서는 자동 비활성화됨)
  "autoupdate": false
}
```

### 3. 실행

```bash
# 환경 변수와 함께 실행
OPENCODE_OFFLINE_MODE=1 npx opencode

# 또는 환경 변수가 이미 설정되어 있다면
npx opencode
```

## 자체 LLM API 요구사항

폐쇄망에서 사용할 자체 LLM API는 다음 중 하나의 형식을 지원해야 합니다:

### 1. Anthropic API 호환

```
POST /v1/messages
Content-Type: application/json
x-api-key: your-api-key

{
  "model": "claude-3-5-sonnet-20241022",
  "messages": [...],
  "max_tokens": 4096
}
```

### 2. OpenAI API 호환

OpenAI 호환 API를 사용하는 경우 provider 설정을 다음과 같이 변경:

```jsonc
{
  "provider": {
    "openai": {
      "options": {
        "apiKey": "your-api-key",
        "baseURL": "http://your-internal-llm-api.com/v1"
      }
    }
  },
  "model": "openai/gpt-4"
}
```

## 문제 해결

### 시작 시 10분 이상 대기

**원인:** 네트워크 타임아웃이 적용되지 않은 fetch 호출

**해결방법:**
1. `OPENCODE_OFFLINE_MODE=1` 환경 변수가 설정되었는지 확인
2. 다음 명령으로 환경 변수 확인:
   ```bash
   echo $OPENCODE_OFFLINE_MODE
   ```

### "Unable to connect" 오류

**원인:** LLM API 엔드포인트 설정 오류

**해결방법:**
1. `ANTHROPIC_BASE_URL` 또는 provider 설정 확인
2. 자체 LLM API가 실행 중이고 접근 가능한지 확인:
   ```bash
   curl http://your-internal-llm-api.com/v1/health
   ```

### LSP 서버 다운로드 시도

**원인:** `OPENCODE_OFFLINE_MODE`가 제대로 설정되지 않음

**해결방법:**
1. 환경 변수 확인
2. 또는 명시적으로 비활성화:
   ```bash
   export OPENCODE_DISABLE_LSP_DOWNLOAD=1
   ```

## 성능 최적화

폐쇄망에서 최적의 성능을 위해:

1. **모든 node_modules 사전 설치**: 인터넷 연결 환경에서 모든 의존성 설치 완료
2. **LSP 서버 사전 설치**: 필요한 LSP 서버를 인터넷 환경에서 미리 다운로드
3. **모델 정보 캐시**: `MODELS_DEV_API_JSON`을 사용하여 로컬 모델 정보 파일 제공

## 변경된 파일 목록

- `packages/opencode/src/flag/flag.ts` - `OPENCODE_OFFLINE_MODE` 플래그 추가
- `packages/opencode/src/installation/index.ts` - 버전 체크 타임아웃 추가
- `packages/opencode/src/config/config.ts` - 원격 설정 로드 타임아웃 추가
- `packages/opencode/src/provider/models-macro.ts` - 모델 정보 로드 타임아웃 추가
- `packages/opencode/src/share/share.ts` - 오프라인 모드에서 비활성화
- `packages/opencode/src/share/share-next.ts` - 오프라인 모드에서 비활성화
- `packages/opencode/src/cli/cmd/import.ts` - URL import 타임아웃 추가

## 라이선스

원본 OpenCode 프로젝트의 라이선스를 따릅니다.

## 기여

폐쇄망 관련 이슈나 개선사항은 Issues에 등록해주세요.
