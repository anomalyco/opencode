---
title: 문제 해결
description: 일반적인 문제와 해결 방법.
---

opencode와 문제를 디버그하려면 로그와 로컬 데이터를 확인하여 디스크에 저장합니다.

---

## 로깅

로그 파일은 다음과 같습니다:

-**macOS/리눅스**: `~/.local/share/opencode/log/`

- **Windows**: 압박 `WIN+R`와 풀 `%USERPROFILE%\.local\share\opencode\log`

로그 파일은 타임스탬프 (예 : `2025-01-09T123456.log`)과 가장 최근 10 로그 파일이 보관됩니다.

자세한 디버그 정보를 얻기 위해 `--log-level` 명령줄 옵션을 사용하여 로그 레벨을 설정할 수 있습니다. 예를 들면, `opencode --log-level DEBUG`.

---

## 저장소

opencode 저장 세션 데이터 및 디스크에 다른 응용 데이터:

-**macOS/리눅스**: `~/.local/share/opencode/`

- **Windows**: 압박 `WIN+R`와 풀 `%USERPROFILE%\.local\share\opencode`

이 디렉토리는 다음과 같습니다:

- `auth.json` - API 키, OAuth 토큰과 같은 인증 데이터
- `log/` - 응용 프로그램 로그
- `project/` - 세션 및 메시지 데이터와 같은 프로젝트별 데이터
- 프로젝트가 Git repo 안에 있는 경우에, 그것은 `./<project-slug>/storage/`에서 저장됩니다
- Git repo가 아닌 경우 `./global/storage/`에 저장됩니다.

---

## 데스크톱 앱

opencode 데스크톱은 배경에서 로컬 opencode 서버 (`opencode-cli` sidecar)를 실행합니다. 대부분의 문제는 misbehaving 플러그인, 손상된 캐시, 또는 나쁜 서버 설정에 의해 발생합니다.

## 빠른 확인

- 완전히 종료하고 앱을 다시 시작.
- 앱이 오류 화면을 보여 주면 ** Restart**를 클릭하고 오류 세부 정보를 복사합니다.
- macOS만: `OpenCode` 메뉴 -> **웹뷰 **(UI가 공백/frozen인 경우).

---

## 플러그인 비활성화

데스크톱 앱이 출시, 거는, 또는 이상한 것에서 충돌하면 플러그인을 비활성화하여 시작합니다.

### 전역 설정 확인

글로벌 설정 파일을 열고 `plugin` 키를 찾습니다.

-**macOS/리눅스**: `~/.config/opencode/opencode.jsonc` (또는 `~/.config/opencode/opencode.json`) -**macOS/Linux** (외부 설치): `~/.local/share/opencode/opencode.jsonc`

- **Windows**: 압박 `WIN+R`와 풀 `%USERPROFILE%\.config\opencode\opencode.jsonc`

구성 된 플러그인이있는 경우, 일시적으로 키를 제거하거나 빈 배열로 설정하여 비활성화하십시오.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

### 플러그인 디렉터리 확인

opencode는 디스크에서 로컬 플러그인을로드 할 수 있습니다. Temporarily 이동 이러한 방법 (또는 폴더 이름을 변경) 및 데스크톱 응용 프로그램을 다시 시작:

- **글로벌 플러그인** -**macOS/리눅스**: `~/.config/opencode/plugins/`
- **Windows**: 압박 `WIN+R`와 풀 `%USERPROFILE%\.config\opencode\plugins`
- **프로젝트 플러그인** (프로젝트 설정만 사용)
- `<your-project>/.opencode/plugins/`

앱이 다시 일하는 경우, 재 활성화 플러그인은 한 번에 문제가 발생할 수 있습니다.

---

#### 캐시 삭제

플러그인을 비활성화하는 경우 도움이되지 않습니다 (또는 플러그인 설치가 붙어있다), 캐시를 삭제 그래서 opencode는 그것을 재구성 할 수 있습니다.

1. Quit opencode 데스크톱 완전히.
2. 캐시 디렉토리 삭제:

-**macOS**: 찾기 -> `Cmd+Shift+G` -> 붙여넣기 `~/.cache/opencode`

- **Linux**: `~/.cache/opencode` 삭제 (또는 `rm -rf ~/.cache/opencode` 실행)
- **Windows**: 압박 `WIN+R`와 풀 `%USERPROFILE%\.cache\opencode`

3. Restart opencode 데스크탑.

---

## 서버 연결 문제 수정

opencode 데스크톱은 자체 로컬 서버(기본)를 시작하거나 구성된 서버 URL에 연결할 수 있습니다.

**"Connection Failed"** 대화 상자 (또는 앱이 스패시 화면을 지나지 않습니다), 사용자 정의 서버 URL을 확인합니다.

### 데스크톱 기본 서버 URL 삭제

Home 화면에서 Server Picker를 열려면 서버 이름(상태 점)을 클릭하십시오. **기본 서버** 섹션에서 **Clear**를 클릭합니다.

#### 설정에서 server.port/server.hostname 제거

`opencode.json(c)`가 `server` 섹션을 포함하면 일시적으로 제거하고 데스크톱 앱을 다시 시작합니다.

### 환경 변수 확인

`OPENCODE_PORT`가 있는 경우, 데스크탑 앱은 로컬 서버의 포트를 사용하려고 합니다.

- `OPENCODE_PORT` (또는 무료 포트를 선택) 및 재시작.

---

## Linux: Wayland / X11 문제

Linux에서 일부 Wayland 설정은 공백 창이나 compositor 오류를 일으킬 수 있습니다.

- If you're on Wayland and the app is blank/crashing, `OC_ALLOW_WAYLAND=1`로 출시하려고합니다.
- 더 나쁜 것을 만드는 경우, 제거하고 X11 세션에서 실행하려고합니다.

---

## Windows: WebView2 런타임

Windows에서 opencode 데스크톱은 Microsoft Edge ** WebView2 실행 시간 **를 요구합니다. 앱이 공백 창에 열거나 시작하지 않을 경우, install/update WebView2를 설치하고 다시 시도하십시오.

---

## Windows: 일반 성능 문제

느린 성능, 파일 액세스 문제 또는 Windows의 terminal 문제를 경험하는 경우 [WSL (Windows Subsystem for Linux)](/docs/windows-wsl)를 사용하여 시도하십시오. WSL은 opencode의 기능으로 더 원활하게 작동하는 Linux 환경을 제공합니다.

---

## 알림이 표시되지 않음

opencode 데스크톱은 시스템 알림을 보여줍니다 :

- OS 설정에서 opencode에 대한 알림이 활성화되고,
- 앱 창이 집중되지 않습니다.

---

## 데스크톱 앱 저장소 재설정 (최후의 수단)

앱이 시작되지 않은 경우 UI 내부에서 설정을 취소할 수 없습니다. 데스크탑 앱의 저장된 상태를 재설정하십시오.

1. Quit opencode 데스크탑.
2. 이 파일을 찾아 삭제 (opencode 데스크톱 앱 데이터 디렉토리에서 라이브):

- `opencode.settings.dat` (데스크톱 기본 서버 URL)
- `opencode.global.dat` 및 `opencode.workspace.*.dat` (최근 서버/프로젝트와 같은 UI 국가)

빠른 디렉토리를 찾을 수:

-**macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (위의 파일명 검색)

- **리눅스 **: 위의 파일명에 대한 `~/.local/share`의 밑에 검색
- **Windows**: `WIN+R` -> `%APPDATA%`를 눌러 (위의 파일 이름을 검색)

---

## 도움 받기

opencode와 문제가 발생하면:

1. ** GitHub의 문제 해결 **

버그 또는 요청 기능을보고하는 가장 좋은 방법은 GitHub 저장소를 통해 다음과 같습니다.

[**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

새로운 문제를 만들기 전에, 당신의 문제가 이미보고 된 경우 기존 문제를 검색.

2. ** 우리의 Discord **

실시간 도움말 및 커뮤니티 토론을 위해 Discord 서버에 가입하십시오.

[**opencode.ai/discord**](https://opencode.ai/discord)

---

## 일반적인 문제

몇 가지 일반적인 문제와 해결 방법.

---

## opencode가 시작되지 않습니다.

1. 오류 메시지에 대한 로그 확인
2. terminal에 있는 산출을 보기 위하여 `--print-logs`로 달리기를 시도하십시오
3. 당신은 `opencode upgrade`를 가진 최신 버전이 있는 것을 지킵니다

---

### 인증 문제

1. TUI에서 `/connect` 명령으로 다시 입력 시도
2. API 키가 유효하다는 것을 확인
3. 네트워크가 공급자의 API에 연결을 허용

---

#### 모델을 사용할 수 없음

1. 공급자와 정통한 확인
2. config의 모델명을 수정한다.
3. 몇몇 모형은 특정한 접근 또는 구독을 요구할지도 모릅니다

만약 당신이 `ProviderModelNotFoundError`에 직면 하는 경우 가장 가능성이 잘못
모델 어딘가를 나타냅니다.
모형은 이렇게 참고되어야 합니다: `<providerId>/<modelId>`

예제:

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

당신이 액세스 할 수있는 모델을 파악하려면, `opencode models`를 실행

---

## ProviderInitError

ProviderInitError가 발생하면 잘못된 구성이나 손상된 구성이 있습니다.

해결하기:

1. 첫째로, 당신의 공급자는 [providers guide](./providers)를 따르기 위하여 제대로 설치됩니다
2. 문제가 발생하면 저장된 구성을 삭제하십시오.

   ```bash
   rm -rf ~/.local/share/opencode
   ```

Windows에서, `WIN+R`를 누르고 삭제하십시오: `%USERPROFILE%\.local\share\opencode`

3. TUI의 `/connect` 명령을 사용하여 공급자와 재해.

---

### AI_APICallError 및 공급자 패키지 문제

API 호출 오류가 발생하면, 이 공급 업체 패키지로 인해 발생할 수 있습니다. opencode 동적 설치 공급자 패키지 (OpenAI, Anthropic, Google 등) 필요 하 고 로컬로 캐시.

공급자 패키지 문제를 해결하려면:

1. 공급자 포장 캐시를 지우십시오:

   ```bash
   rm -rf ~/.cache/opencode
   ```

Windows에서, `WIN+R`를 누르고 삭제하십시오: `%USERPROFILE%\.cache\opencode`

2. 최신 공급자 포장을 재설치하는 Restart opencode

이것은 종종 모델 매개 변수와 API 변경과 호환성 문제를 해결하는 공급자 패키지의 가장 최근 버전을 다운로드하기 위해 opencode를 강제합니다.

---

#### Linux에서 복사/붙여넣기 작동 안 함

Linux 사용자는 다음과 같은 클립 보드 유틸리티 중 하나가 복사 / 붙여 넣기 기능에 설치해야합니다.

** X11 시스템:**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**웨이랜드 시스템:**

```bash
apt install -y wl-clipboard
```

** 헤드리스 환경에 대한:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

opencode는 당신이 Wayland를 사용하고 `wl-clipboard`를 선호하는 경우에 검출할 것입니다, 그렇지 않으면의 순서에 있는 클립보드 공구를 찾아낼 것입니다: `xclip`와 `xsel`.
