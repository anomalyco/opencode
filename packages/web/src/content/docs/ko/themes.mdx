---
title: 테마
description: 내장 테마를 선택하거나 자신만의 테마를 정의하세요.
---

OpenCode를 사용하면 여러 내장 테마 중 하나에서 선택할 수 있으며 terminal 테마에 적응하는 테마를 사용하거나 사용자 정의 테마를 정의 할 수 있습니다.

기본적으로 OpenCode는 자체 `opencode` 테마를 사용합니다.

---

## 터미널 요구 사항

테마가 전체 색상 팔레트로 올바르게 표시되려면 터미널이 **truecolor** (24비트 색상)를 지원해야 합니다. 대부분의 최신 터미널은 기본적으로 이를 지원하지만, 활성화해야 할 수도 있습니다:

- **지원 확인**: `echo $COLORTERM` 실행 - `truecolor` 또는 `24bit`가 출력되어야 합니다.
- **truecolor 활성화**: 셸 프로필에서 환경 변수 `COLORTERM=truecolor`를 설정하십시오.
- **터미널 호환성**: 터미널 에뮬레이터가 24비트 색상을 지원하는지 확인하십시오 (iTerm2, Alacritty, Kitty, Windows Terminal 및 최신 버전의 GNOME Terminal 등 대부분의 최신 터미널이 지원함).

truecolor 지원이 없으면 테마가 감소된 색상 정확도로 표시되거나 가장 가까운 256색 근사치로 대체될 수 있습니다.

---

## 내장 테마

OpenCode는 여러 내장 테마와 함께 제공됩니다.

| 이름                   | 설명                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| `system`               | terminal 배경 색상에 맞춰 자동으로 조정됨                           |
| `tokyonight`           | [Tokyonight](https://github.com/folke/tokyonight.nvim) 테마 기반    |
| `everforest`           | [Everforest](https://github.com/sainnhe/everforest) 테마 기반       |
| `ayu`                  | [Ayu](https://github.com/ayu-theme) 다크 테마 기반                  |
| `catppuccin`           | [Catppuccin](https://github.com/catppuccin) 테마 기반               |
| `catppuccin-macchiato` | [Catppuccin](https://github.com/catppuccin) 테마 기반               |
| `gruvbox`              | [Gruvbox](https://github.com/morhetz/gruvbox) 테마 기반             |
| `kanagawa`             | [Kanagawa](https://github.com/rebelot/kanagawa.nvim) 테마 기반      |
| `nord`                 | [Nord](https://github.com/nordtheme/nord) 테마 기반                 |
| `matrix`               | 검은 배경에 녹색 텍스트의 해커 스타일 테마                          |
| `one-dark`             | [Atom One](https://github.com/Th3Whit3Wolf/one-nvim) Dark 테마 기반 |

그리고 더, 우리는 끊임없이 새로운 테마를 추가하고 있습니다.

---

## 시스템 테마

`system` 테마는 터미널의 색상 스키마에 자동으로 적응하도록 설계되었습니다. 고정 색상을 사용하는 기존 테마와 달리, system 테마는:

- **그레이스케일 생성**: 터미널의 배경 색상을 기반으로 사용자 정의 그레이스케일을 생성하여 최적의 대비를 보장합니다.
- **ANSI 색상 사용**: 구문 강조 및 UI 요소에 표준 ANSI 색상(0-15)을 활용하여 터미널의 색상 팔레트를 존중합니다.
- **터미널 기본값 유지**: 텍스트 및 배경 색상에 `none`을 사용하여 터미널의 기본 모양을 유지합니다.

시스템 테마는 다음과 같은 사용자에게 적합합니다:

- OpenCode가 터미널의 모양과 일치하기를 원하는 경우
- 사용자 정의 터미널 색상 스키마를 사용하는 경우
- 모든 터미널 애플리케이션에서 일관된 모양을 선호하는 경우

---

## 테마 사용

`/theme` 명령어로 테마 선택기를 불러와 테마를 선택할 수 있습니다. 또는 `tui.json`에서 지정할 수 있습니다.

```json title="tui.json" {3}
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "tokyonight"
}
```

---

## 사용자 정의 테마

OpenCode는 사용자가 쉽게 테마를 만들고 사용자 정의할 수 있도록 유연한 JSON 기반 테마 시스템을 지원합니다.

---

### 계층 구조

테마는 다음 순서대로 여러 디렉토리에서 로드되며, 나중 디렉토리가 이전 디렉토리를 덮어씁니다:

1. **내장 테마 (Built-in themes)** - 바이너리에 내장되어 있습니다.
2. **사용자 설정 디렉토리 (User config directory)** - `~/.config/opencode/themes/*.json` 또는 `$XDG_CONFIG_HOME/opencode/themes/*.json`에 정의됩니다.
3. **프로젝트 루트 디렉토리 (Project root directory)** - `<project-root>/.opencode/themes/*.json`에 정의됩니다.
4. **현재 작업 디렉토리 (Current working directory)** - `./.opencode/themes/*.json`에 정의됩니다.

여러 디렉토리에 같은 이름의 테마가 있는 경우, 더 높은 우선 순위를 가진 디렉토리의 테마가 사용됩니다.

---

### 테마 만들기

사용자 정의 테마를 만들려면 테마 디렉토리 중 하나에 JSON 파일을 만듭니다.

사용자 전역 테마:

```bash no-frame
mkdir -p ~/.config/opencode/themes
vim ~/.config/opencode/themes/my-theme.json
```

프로젝트별 테마:

```bash no-frame
mkdir -p .opencode/themes
vim .opencode/themes/my-theme.json
```

---

### JSON 형식

테마는 다음을 지원하는 유연한 JSON 형식을 사용합니다:

- **Hex 색상**: `"#ffffff"`
- **ANSI 색상**: `3` (0-255)
- **색상 참조**: `"primary"` 또는 사용자 정의 정의
- **다크/라이트 변형**: `{"dark": "#000", "light": "#fff"}`
- **색상 없음**: `"none"` - 터미널의 기본 색상 또는 투명 사용

---

### 색상 정의

`defs` 섹션은 선택 사항이며 테마 내에서 참조할 수 있는 재사용 가능한 색상을 정의할 수 있습니다.

---

### 터미널 기본값

`"none"`이라는 특별한 값은 모든 색상에 대해 터미널의 기본 색상을 상속하는 데 사용할 수 있습니다. 이는 특히 터미널의 색상 스키마와 매끄럽게 어우러지는 테마를 만들 때 유용합니다:

- `"text": "none"` - 터미널의 기본 전경색 사용
- `"background": "none"` - 터미널의 기본 배경색 사용

---

### 예제

사용자 정의 테마의 예입니다:

```json title="my-theme.json"
{
  "$schema": "https://opencode.ai/theme.json",
  "defs": {
    "nord0": "#2E3440",
    "nord1": "#3B4252",
    "nord2": "#434C5E",
    "nord3": "#4C566A",
    "nord4": "#D8DEE9",
    "nord5": "#E5E9F0",
    "nord6": "#ECEFF4",
    "nord7": "#8FBCBB",
    "nord8": "#88C0D0",
    "nord9": "#81A1C1",
    "nord10": "#5E81AC",
    "nord11": "#BF616A",
    "nord12": "#D08770",
    "nord13": "#EBCB8B",
    "nord14": "#A3BE8C",
    "nord15": "#B48EAD"
  },
  "theme": {
    "primary": {
      "dark": "nord8",
      "light": "nord10"
    },
    "secondary": {
      "dark": "nord9",
      "light": "nord9"
    },
    "accent": {
      "dark": "nord7",
      "light": "nord7"
    },
    "error": {
      "dark": "nord11",
      "light": "nord11"
    },
    "warning": {
      "dark": "nord12",
      "light": "nord12"
    },
    "success": {
      "dark": "nord14",
      "light": "nord14"
    },
    "info": {
      "dark": "nord8",
      "light": "nord10"
    },
    "text": {
      "dark": "nord4",
      "light": "nord0"
    },
    "textMuted": {
      "dark": "nord3",
      "light": "nord1"
    },
    "background": {
      "dark": "nord0",
      "light": "nord6"
    },
    "backgroundPanel": {
      "dark": "nord1",
      "light": "nord5"
    },
    "backgroundElement": {
      "dark": "nord1",
      "light": "nord4"
    },
    "border": {
      "dark": "nord2",
      "light": "nord3"
    },
    "borderActive": {
      "dark": "nord3",
      "light": "nord2"
    },
    "borderSubtle": {
      "dark": "nord2",
      "light": "nord3"
    },
    "diffAdded": {
      "dark": "nord14",
      "light": "nord14"
    },
    "diffRemoved": {
      "dark": "nord11",
      "light": "nord11"
    },
    "diffContext": {
      "dark": "nord3",
      "light": "nord3"
    },
    "diffHunkHeader": {
      "dark": "nord3",
      "light": "nord3"
    },
    "diffHighlightAdded": {
      "dark": "nord14",
      "light": "nord14"
    },
    "diffHighlightRemoved": {
      "dark": "nord11",
      "light": "nord11"
    },
    "diffAddedBg": {
      "dark": "#3B4252",
      "light": "#E5E9F0"
    },
    "diffRemovedBg": {
      "dark": "#3B4252",
      "light": "#E5E9F0"
    },
    "diffContextBg": {
      "dark": "nord1",
      "light": "nord5"
    },
    "diffLineNumber": {
      "dark": "nord2",
      "light": "nord4"
    },
    "diffAddedLineNumberBg": {
      "dark": "#3B4252",
      "light": "#E5E9F0"
    },
    "diffRemovedLineNumberBg": {
      "dark": "#3B4252",
      "light": "#E5E9F0"
    },
    "markdownText": {
      "dark": "nord4",
      "light": "nord0"
    },
    "markdownHeading": {
      "dark": "nord8",
      "light": "nord10"
    },
    "markdownLink": {
      "dark": "nord9",
      "light": "nord9"
    },
    "markdownLinkText": {
      "dark": "nord7",
      "light": "nord7"
    },
    "markdownCode": {
      "dark": "nord14",
      "light": "nord14"
    },
    "markdownBlockQuote": {
      "dark": "nord3",
      "light": "nord3"
    },
    "markdownEmph": {
      "dark": "nord12",
      "light": "nord12"
    },
    "markdownStrong": {
      "dark": "nord13",
      "light": "nord13"
    },
    "markdownHorizontalRule": {
      "dark": "nord3",
      "light": "nord3"
    },
    "markdownListItem": {
      "dark": "nord8",
      "light": "nord10"
    },
    "markdownListEnumeration": {
      "dark": "nord7",
      "light": "nord7"
    },
    "markdownImage": {
      "dark": "nord9",
      "light": "nord9"
    },
    "markdownImageText": {
      "dark": "nord7",
      "light": "nord7"
    },
    "markdownCodeBlock": {
      "dark": "nord4",
      "light": "nord0"
    },
    "syntaxComment": {
      "dark": "nord3",
      "light": "nord3"
    },
    "syntaxKeyword": {
      "dark": "nord9",
      "light": "nord9"
    },
    "syntaxFunction": {
      "dark": "nord8",
      "light": "nord8"
    },
    "syntaxVariable": {
      "dark": "nord7",
      "light": "nord7"
    },
    "syntaxString": {
      "dark": "nord14",
      "light": "nord14"
    },
    "syntaxNumber": {
      "dark": "nord15",
      "light": "nord15"
    },
    "syntaxType": {
      "dark": "nord7",
      "light": "nord7"
    },
    "syntaxOperator": {
      "dark": "nord9",
      "light": "nord9"
    },
    "syntaxPunctuation": {
      "dark": "nord4",
      "light": "nord0"
    }
  }
}
```
