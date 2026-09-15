# تقرير الحالة النهائي — MCP Core Capabilities

**التاريخ:** 2026-09-15
**الفرع:** `feat/engineering-memory-v1` (فعلي — `git branch --show-current`)
**النطاق:** تفعيل MCP + Skills فقط — دون Build أو تعديل مصدر جديد في هذه الخطوة

## القدرات المفعلة

| القدرة | الحالة | الدليل |
|---|---|---|
| GitHub CLI (`gh`) | FUNCTIONALLY_ACTIVE | يعمل بصورة طبيعية |
| GitHub Remote MCP | CLIENT_OAUTH_INCOMPATIBLE | أُزيل من إعداد المشروع |
| Context7 MCP | FUNCTIONALLY_VERIFIED | `resolve-library-id` + `query-docs` مكتملان |
| Playwright MCP | FUNCTIONALLY_VERIFIED | `navigate` + `snapshot` مكتملان |
| AI Engineer Skill | FUNCTIONALLY_VERIFIED | `.opencode/skills/ai-engineer/SKILL.md` |
| Prompt Engineering Skill | FUNCTIONALLY_VERIFIED | `.opencode/skills/prompt-engineering/SKILL.md` |

## نسخة OpenCode العاملة

```
Binary:         packages/opencode/dist/opencode-linux-x64/bin/opencode
Active symlink: ~/.local/bin/opencode
              → /mnt/k/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode
Version:        0.0.0-feat/engineering-memory-v1-202609151042
SHA-256 prefix: f115e763b09d9c87
```

## إصلاح MCP — ثلاث طبقات

1. دعم `codemode` في MCP schema — `packages/core/src/v1/config/mcp.ts`
2. الاحتفاظ بـ `codemode` عبر V2 compatibility conversion — `packages/opencode/src/config/v2-compat.ts`
3. إسقاط أدوات MCP المباشرة في Tool Registry — `packages/opencode/src/tool/registry.ts`

اختبار الانحدار:

```
packages/opencode/test/tool/mcp-codemode-direct.test.ts
PASS: 1
FAIL: 0
```

## الدليل الوظيفي

### Playwright (جلسة واحدة، أداتان بالترتيب)

```
playwright_browser_navigate STATUS=completed ERROR=None
playwright_browser_snapshot STATUS=completed ERROR=None
```

- المصدر: `/tmp/playwright-two-tools.json`
- الصفحة: `https://demo.playwright.dev/todomvc/#/` — `React • TodoMVC`
- الـ Snapshot رجع `textbox "What needs to be done?"` وعناصر `todos` المتوقعة.

### Context7

- `context7_resolve-library-id`: `React` → `/reactjs/react.dev`
- `context7_query-docs`: أمثلة `useEffect cleanup` حديثة من `react.dev`

### المتصفحات المثبتة

```
Chrome for Testing 154.0.8037.0
Playwright Chromium v1244
Chrome Headless Shell v1244
Linux browser dependencies complete
```

## حالة Git

```
IMPLEMENTED_LOCALLY_NOT_ADMITTED
COMMIT / PUSH: NOT PERFORMED
```

### جاهز لـ Commit منفصل (نطاق MCP الحالي)

```bash
git add .opencode/opencode.jsonc \
  packages/core/src/v1/config/mcp.ts \
  packages/opencode/src/config/v2-compat.ts \
  packages/opencode/src/tool/registry.ts \
  packages/opencode/test/tool/mcp-codemode-direct.test.ts \
  .opencode/skills/ai-engineer/SKILL.md \
  .opencode/skills/prompt-engineering/SKILL.md
```

| الملف | النوع |
|---|---|
| `.opencode/opencode.jsonc` | M — إعداد Playwright + Context7 |
| `packages/core/src/v1/config/mcp.ts` | M — schema `codemode` |
| `packages/opencode/src/config/v2-compat.ts` | M — تمرير `codemode` |
| `packages/opencode/src/tool/registry.ts` | M — أدوات MCP المباشرة |
| `packages/opencode/test/tool/mcp-codemode-direct.test.ts` | ?? — اختبار الانحدار |
| `.opencode/skills/ai-engineer/SKILL.md` | ?? — مهارة موثقة |
| `.opencode/skills/prompt-engineering/SKILL.md` | ?? — مهارة موثقة |

### خارج النطاق — لا تخلط مع Commit الحالي

| الملف | السبب |
|---|---|
| `packages/core/src/effect/layer-node.ts` | M — null-guards + `Layer.mergeAll`، نطاق مختلف |
| `packages/opencode/src/session/system.ts` | M — فلترة references، نطاق مختلف |
| `packages/opencode/src/skill/index.ts` | M — فلترة skills، نطاق مختلف |
| `packages/core/test/effect/layer-node/c3-pinning.test.ts` | ?? — من 12 سبتمبر |
| `packages/knowledge-engine/src/interactive.ts` | ?? — من 12 سبتمبر |

### مستبعد — لا يدخل Commit

```
.playwright-mcp/
├── console-2026-09-15T15-22-43-125Z.log
├── console-2026-09-15T15-26-35-155Z.log
├── console-2026-09-15T15-46-46-904Z.log
├── page-2026-09-15T15-22-45-778Z.yml
├── page-2026-09-15T15-26-36-462Z.yml
└── page-2026-09-15T15-46-48-231Z.yml
```

## التحقق من عدم تتبع مخرجات Playwright

```bash
git ls-files | grep -E "playwright-mcp" || echo "OK: no .playwright-mcp tracked"
# النتيجة: OK: no .playwright-mcp tracked ✅

git check-ignore -v .playwright-mcp
# النتيجة: NOT IGNORED ⚠️ — غير متجاهَل في .gitignore بعد
```

**الحكم:** المخرجات **غير متتبعة** حاليًا (آمنة ما دام لا يُستخدم `git add .`)، لكنها **غير متجاهلة** رسميًا. التوصية: إضافة `.playwright-mcp/` إلى `.gitignore` في تنظيف Git اللاحق قبل أي `add` واسع، وتحديد سياسة تجاهل صريحة.

## الحكم النهائي

```
PLAYWRIGHT_MCP_FUNCTIONALLY_VERIFIED ✅
CONTEXT7_MCP_FUNCTIONALLY_VERIFIED ✅
AI_ENGINEER_SKILL_FUNCTIONALLY_VERIFIED ✅
PROMPT_ENGINEERING_SKILL_FUNCTIONALLY_VERIFIED ✅
GITHUB_NATIVE_CLI_FUNCTIONALLY_ACTIVE ✅

OPENCODE MCP CORE CAPABILITIES: ACTIVE
REPOSITORY ADMISSION: NOT STARTED
COMMIT / PUSH: NOT PERFORMED
```

المتبقي لاحقًا: تنظيف نطاق Git، فصل الملفات السابقة غير المرتبطة، وإعداد Commit مخصص دون خلط العمل الحالي بالتعديلات القديمة.
