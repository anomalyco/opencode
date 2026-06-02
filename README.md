# IMECODE

폐쇄망(에어갭) 환경에서 사용하는 사내 AI 코딩 에이전트입니다. [opencode](https://github.com/anomalyco/opencode)를 포크해 **사내 vLLM(OpenAI 호환) 엔드포인트 전용**으로 개편했습니다. 외부 모델 프로바이더는 모두 비활성화되어 있고, 지정한 내부 엔드포인트로만 통신합니다.

- **단일 네이티브 바이너리** — Bun으로 컴파일된 독립 실행 파일. 폐쇄망에 **런타임(Node/Bun) 설치 불필요**.
- **vLLM 전용 잠금** — 모델/프로바이더 목록에 사내 vLLM만 노출. 외부 인증/connect 비활성화.
- **TUI 온보딩** — 첫 실행 시 엔드포인트·모델·API 키를 입력받고, 이후 `/endpoint`로 언제든 변경.

---

## 1. 설치 (폐쇄망)

빌드 산출물 바이너리 **하나만** 반입하면 됩니다. (빌드는 [§5](#5-소스에서-빌드-빌드머신)를 외부망에서 수행)

```bash
# 빌드머신에서 생성된 바이너리를 폐쇄망 호스트로 복사
#   linux x64:         dist/imecode-linux-x64/bin/imecode
#   linux x64(구형 CPU): dist/imecode-linux-x64-baseline/bin/imecode   # AVX2 미지원 시
#   linux arm64:       dist/imecode-linux-arm64/bin/imecode

install -m 0755 imecode /usr/local/bin/imecode   # 또는 원하는 PATH 위치로
imecode --version
```

> CPU가 AVX2를 지원하지 않으면 `-baseline` 변형을 사용하세요. (`grep -q avx2 /proc/cpuinfo`로 확인)

---

## 2. 엔드포인트 설정

설정 우선순위(낮음→높음): **빌드 기본값 → `~/.config/imecode/imecode.json` → 프로젝트 `.imecode/imecode.json` → 환경변수**. 즉 환경변수가 항상 최우선입니다.

### 방법 A — 첫 실행 온보딩 (권장)

API 키가 설정돼 있지 않으면 첫 실행 시 자동으로 설정 다이얼로그가 뜹니다. **엔드포인트 URL → 모델명 → API 키** 순서로 입력하면 `~/.config/imecode/imecode.json`에 저장되고 즉시 적용됩니다.

```bash
imecode          # 첫 실행 → 온보딩 → 키 입력
```

언제든 TUI 안에서 `/endpoint` (별칭 `/connect`, `/vllm`)로 다시 설정할 수 있습니다.

### 방법 B — 환경변수

```bash
export IMECODE_VLLM_BASE_URL="http://<vllm-host>:<port>/v1"   # OpenAI 호환 엔드포인트
export IMECODE_VLLM_MODEL="<served-model-name>"              # 서버가 서빙하는 모델 id
export IMECODE_VLLM_API_KEY="<bearer-token>"                 # 인증 키 (없으면 생략)
imecode
```

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `IMECODE_VLLM_BASE_URL` | `http://100.105.126.86:30090/v1` | vLLM/LiteLLM OpenAI 호환 baseURL |
| `IMECODE_VLLM_MODEL` | `qwen3-6-35b` | 서빙 모델 id (`/v1/models`의 `id`와 일치) |
| `IMECODE_VLLM_API_KEY` | *(없음)* | Bearer 토큰. **바이너리에 박혀있지 않으며** 런타임에 주입 |
| `IMECODE_VLLM_NAME` | `Internal vLLM` | 프로바이더 표시 이름 |
| `IMECODE_VLLM_CONTEXT` | `32768` | 컨텍스트 토큰 한도 |
| `IMECODE_VLLM_MAX_OUTPUT` | `8192` | 응답 토큰 한도 |
| `IMECODE_ALLOW_EXTERNAL_AUTH` | *(없음)* | `1`로 두면 `auth login`(외부 프로바이더 인증) 재허용 |

> **보안:** API 키는 소스/바이너리/깃에 포함되지 않습니다. 운영 시 env 또는 온보딩으로 주입하세요. 가능하면 마스터 키 대신 **스코프된 키**를 발급해 사용하길 권장합니다.

### 방법 C — 설정 파일 직접 작성

`~/.config/imecode/imecode.json` (전역) 또는 프로젝트 루트 `imecode.json`:

```json
{
  "model": "vllm/qwen3-6-35b",
  "provider": {
    "vllm": {
      "options": {
        "baseURL": "http://<vllm-host>:<port>/v1",
        "apiKey": "<bearer-token>"
      },
      "models": {
        "qwen3-6-35b": { "id": "qwen3-6-35b", "tool_call": true, "reasoning": true }
      }
    }
  }
}
```

---

## 3. 실행

```bash
imecode                       # 대화형 TUI 실행
imecode run "리팩터해줘 ..."    # 메시지 한 번 보내고 결과 출력 (비대화형)
imecode --help                # 전체 명령/옵션
```

TUI 진입 후: 메시지 입력으로 대화, `/`로 명령 팔레트, `/endpoint`로 엔드포인트 변경, `Tab`으로 에이전트(build/plan) 전환.

---

## 4. 설정/데이터 위치

| 종류 | 경로 |
|---|---|
| 전역 설정 | `~/.config/imecode/imecode.json` |
| 프로젝트 설정 | `<repo>/imecode.json` 또는 `<repo>/.imecode/imecode.json` |
| 커스텀 명령/에이전트/스킬 | `.imecode/commands`, `.imecode/agent`, `.imecode/skills` |
| 상태/캐시 | `~/.local/share/imecode`, `~/.cache/imecode` |

---

## 5. 소스에서 빌드 (빌드머신)

빌드는 **인터넷이 되는 빌드머신**에서 수행합니다 (의존성 설치에 네트워크 필요). 산출물 바이너리만 폐쇄망으로 옮깁니다.

**요구사항:** [Bun](https://bun.sh) `1.3.14`

```bash
# Bun 설치 (없으면). unzip 필요: sudo apt install -y unzip
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"

git clone https://github.com/junnystateofmind/imecode.git
cd imecode
bun install
bun turbo typecheck                       # (선택) 타입 검증
cd packages/opencode && bun run build     # 전 플랫폼 바이너리 생성 → dist/
```

산출물:

```
packages/opencode/dist/imecode-linux-x64/bin/imecode          # 폐쇄망 linux x64 반입 대상
packages/opencode/dist/imecode-linux-x64-baseline/bin/imecode # AVX2 미지원 CPU
packages/opencode/dist/imecode-linux-arm64/bin/imecode
... (darwin/windows 변형도 함께 생성됨)
```

빌드 끝에 현재 플랫폼 바이너리로 `imecode --version` 스모크 테스트가 자동 실행됩니다.

---

## 6. 동작 특성 (폐쇄망 잠금)

- **단일 프로바이더**: `enabled_providers: ["vllm"]`이 기본 시드되어 모델/프로바이더 목록에 vLLM만 노출됩니다.
- **외부 프로바이더 비활성화**: Anthropic/OpenAI/Google 등 외부 SDK 프로바이더와 OpenCode Zen/Go는 선택 불가. `auth login`·`/connect`·"Other(커스텀)" 진입점이 막혀 있습니다 (`IMECODE_ALLOW_EXTERNAL_AUTH=1`로 해제 가능).
- **오프라인**: 모델 카탈로그(models.dev)는 빌드 시 스냅샷이 내장되어 기동 시 네트워크를 타지 않습니다.
- **추론 모델 지원**: 기본 모델 `qwen3-6-35b`는 reasoning + tool-calling 모델로 설정돼 있습니다.

---

## 라이선스

upstream [opencode](https://github.com/anomalyco/opencode) (MIT) 기반의 사내 포크입니다.
