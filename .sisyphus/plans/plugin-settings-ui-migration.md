# Plugin Settings UI Migration

## Context

Plugin Settings UI yanlışlıkla `packages/console/` (cloud SaaS dashboard — kullanıcının görmediği yer) altına yazıldı.
Doğru yer `packages/app/` — `opencode web` komutuyla açılan gerçek arayüz.

Backend tamamen hazır ve değişmeyecek:

- `packages/plugin/src/index.ts` → SettingDefinition, PluginSettingsSchema tipleri
- `packages/opencode/src/config/config.ts` → plugin_settings alanı
- `packages/opencode/src/plugin/index.ts` → Plugin.schemas()
- `packages/opencode/src/server/routes/config.ts` → GET/PATCH /config/plugin-settings

## Architecture / Key Decisions

- **Framework**: SolidJS (packages/app kullanıyor)
- **Data fetching**: `createResource()` ile `GET /config/plugin-settings` çağrısı
- **Form state**: `createStore()` ile per-plugin dirty tracking
- **Save**: Per-plugin "Save" butonu → `PATCH /config/plugin-settings` → `{ plugin_id, settings }`
- **API çağrısı**: Hono RPC client varsa `globalSDK.client.config["plugin-settings"].$get()` kullan; yoksa `fetch(globalSDK.url + "/config/plugin-settings")` + auth header
- **Icon**: "puzzle" ikonu mevcut değil → `mcp` ikonu kullanılacak
- **Secret alanlar**: Mask placeholder göster, kullanıcı değiştirmediyse PATCH payload'ına dahil ETME
- **SettingsRow**: Yerel tanım (export edilmiyor, her settings dosyası kendi tanımlıyor)
- **i18n**: `en.ts` + 16 locale dosyası (ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht) — tüm dillere çeviri eklenecek

## API Shape Reference

```
GET /config/plugin-settings
→ { schemas: PluginSettingsSchema[], values: Record<string, Record<string, unknown>> }

PATCH /config/plugin-settings
← { plugin_id: string, settings: Record<string, unknown> }
→ { plugin_settings: Record<string, Record<string, unknown>> }
```

```ts
type SettingDefinition = {
  type: "string" | "number" | "boolean" | "select" | "secret"
  title: string
  description?: string
  default?: unknown
  required?: boolean
  placeholder?: string
  enum?: string[] // select type
  enumLabels?: string[] // select type
}

type PluginSettingsSchema = {
  id: string
  title: string
  properties: Record<string, SettingDefinition>
}
```

## Tasks

- [x] Task 1: Console değişikliklerini geri al
- [x] Task 2: i18n anahtarları ekle (tüm diller)
- [x] Task 3: settings-plugins.tsx oluştur (YENİ DOSYA)
- [x] Task 4: dialog-settings.tsx güncelle
- [x] Task 5: Typecheck & Build doğrulama

### Task 1: Console değişikliklerini geri al

**File**: packages/console/ (3 dosya)
**Action**: Revert

```bash
git checkout dev -- packages/console/
```

Bu komut şu 3 dosyayı geri alır:

- `packages/console/app/src/routes/workspace/[id]/settings/index.tsx` (modified → original)
- `packages/console/app/src/routes/workspace/[id]/settings/plugin-settings-section.tsx` (new → deleted)
- `packages/console/app/src/routes/workspace/[id]/settings/plugin-settings-section.module.css` (new → deleted)

**QA**: Revert sonrası `git diff dev -- packages/console/` boş çıkmalı.

---

### Task 2: i18n anahtarları ekle (tüm diller)

**Files**: `packages/app/src/i18n/en.ts` + 16 locale dosyası
**Action**: Edit — her dosyada mevcut `settings.models.*` key'lerinden sonra aşağıdaki anahtarları ekle.

#### 2a. English (`en.ts`)

```ts
"settings.plugins.title": "Plugins",
"settings.plugins.description": "Configure plugin settings",
"settings.plugins.empty": "No plugins with configurable settings",
"settings.plugins.save": "Save",
"settings.plugins.saved.title": "Settings saved",
"settings.plugins.saved.description": "{{plugin}} settings updated successfully",
"settings.plugins.save_failed.title": "Failed to save",
"settings.plugins.save_failed.description": "Could not update {{plugin}} settings",
"settings.plugins.loading": "Loading plugin settings...",
"settings.plugins.error": "Failed to load plugin settings",
```

#### 2b. Arabic (`ar.ts`)

```ts
"settings.plugins.title": "الإضافات",
"settings.plugins.description": "تكوين إعدادات الإضافات",
"settings.plugins.empty": "لا توجد إضافات بإعدادات قابلة للتكوين",
"settings.plugins.save": "حفظ",
"settings.plugins.saved.title": "تم حفظ الإعدادات",
"settings.plugins.saved.description": "تم تحديث إعدادات {{plugin}} بنجاح",
"settings.plugins.save_failed.title": "فشل في الحفظ",
"settings.plugins.save_failed.description": "تعذر تحديث إعدادات {{plugin}}",
"settings.plugins.loading": "جاري تحميل إعدادات الإضافات...",
"settings.plugins.error": "فشل في تحميل إعدادات الإضافات",
```

#### 2c. Brazilian Portuguese (`br.ts`)

```ts
"settings.plugins.title": "Plugins",
"settings.plugins.description": "Configurar opções de plugins",
"settings.plugins.empty": "Nenhum plugin com configurações disponíveis",
"settings.plugins.save": "Salvar",
"settings.plugins.saved.title": "Configurações salvas",
"settings.plugins.saved.description": "Configurações de {{plugin}} atualizadas com sucesso",
"settings.plugins.save_failed.title": "Falha ao salvar",
"settings.plugins.save_failed.description": "Não foi possível atualizar as configurações de {{plugin}}",
"settings.plugins.loading": "Carregando configurações de plugins...",
"settings.plugins.error": "Falha ao carregar configurações de plugins",
```

#### 2d. Bosnian (`bs.ts`)

```ts
"settings.plugins.title": "Dodaci",
"settings.plugins.description": "Konfiguriši postavke dodataka",
"settings.plugins.empty": "Nema dodataka s konfigurabilnim postavkama",
"settings.plugins.save": "Sačuvaj",
"settings.plugins.saved.title": "Postavke sačuvane",
"settings.plugins.saved.description": "Postavke za {{plugin}} su uspješno ažurirane",
"settings.plugins.save_failed.title": "Greška pri čuvanju",
"settings.plugins.save_failed.description": "Nije moguće ažurirati postavke za {{plugin}}",
"settings.plugins.loading": "Učitavanje postavki dodataka...",
"settings.plugins.error": "Greška pri učitavanju postavki dodataka",
```

#### 2e. Danish (`da.ts`)

```ts
"settings.plugins.title": "Plugins",
"settings.plugins.description": "Konfigurer plugin-indstillinger",
"settings.plugins.empty": "Ingen plugins med konfigurerbare indstillinger",
"settings.plugins.save": "Gem",
"settings.plugins.saved.title": "Indstillinger gemt",
"settings.plugins.saved.description": "{{plugin}}-indstillinger opdateret",
"settings.plugins.save_failed.title": "Kunne ikke gemme",
"settings.plugins.save_failed.description": "Kunne ikke opdatere {{plugin}}-indstillinger",
"settings.plugins.loading": "Indlæser plugin-indstillinger...",
"settings.plugins.error": "Kunne ikke indlæse plugin-indstillinger",
```

#### 2f. German (`de.ts`)

```ts
"settings.plugins.title": "Plugins",
"settings.plugins.description": "Plugin-Einstellungen konfigurieren",
"settings.plugins.empty": "Keine Plugins mit konfigurierbaren Einstellungen",
"settings.plugins.save": "Speichern",
"settings.plugins.saved.title": "Einstellungen gespeichert",
"settings.plugins.saved.description": "{{plugin}}-Einstellungen erfolgreich aktualisiert",
"settings.plugins.save_failed.title": "Speichern fehlgeschlagen",
"settings.plugins.save_failed.description": "{{plugin}}-Einstellungen konnten nicht aktualisiert werden",
"settings.plugins.loading": "Plugin-Einstellungen werden geladen...",
"settings.plugins.error": "Plugin-Einstellungen konnten nicht geladen werden",
```

#### 2g. Spanish (`es.ts`)

```ts
"settings.plugins.title": "Plugins",
"settings.plugins.description": "Configurar ajustes de plugins",
"settings.plugins.empty": "No hay plugins con ajustes configurables",
"settings.plugins.save": "Guardar",
"settings.plugins.saved.title": "Ajustes guardados",
"settings.plugins.saved.description": "Ajustes de {{plugin}} actualizados correctamente",
"settings.plugins.save_failed.title": "Error al guardar",
"settings.plugins.save_failed.description": "No se pudieron actualizar los ajustes de {{plugin}}",
"settings.plugins.loading": "Cargando ajustes de plugins...",
"settings.plugins.error": "Error al cargar los ajustes de plugins",
```

#### 2h. French (`fr.ts`)

```ts
"settings.plugins.title": "Plugins",
"settings.plugins.description": "Configurer les paramètres des plugins",
"settings.plugins.empty": "Aucun plugin avec des paramètres configurables",
"settings.plugins.save": "Enregistrer",
"settings.plugins.saved.title": "Paramètres enregistrés",
"settings.plugins.saved.description": "Paramètres de {{plugin}} mis à jour avec succès",
"settings.plugins.save_failed.title": "Échec de l'enregistrement",
"settings.plugins.save_failed.description": "Impossible de mettre à jour les paramètres de {{plugin}}",
"settings.plugins.loading": "Chargement des paramètres des plugins...",
"settings.plugins.error": "Échec du chargement des paramètres des plugins",
```

#### 2i. Japanese (`ja.ts`)

```ts
"settings.plugins.title": "プラグイン",
"settings.plugins.description": "プラグイン設定を構成する",
"settings.plugins.empty": "設定可能なプラグインはありません",
"settings.plugins.save": "保存",
"settings.plugins.saved.title": "設定を保存しました",
"settings.plugins.saved.description": "{{plugin}} の設定が正常に更新されました",
"settings.plugins.save_failed.title": "保存に失敗しました",
"settings.plugins.save_failed.description": "{{plugin}} の設定を更新できませんでした",
"settings.plugins.loading": "プラグイン設定を読み込み中...",
"settings.plugins.error": "プラグイン設定の読み込みに失敗しました",
```

#### 2j. Korean (`ko.ts`)

```ts
"settings.plugins.title": "플러그인",
"settings.plugins.description": "플러그인 설정 구성",
"settings.plugins.empty": "구성 가능한 설정이 있는 플러그인이 없습니다",
"settings.plugins.save": "저장",
"settings.plugins.saved.title": "설정 저장됨",
"settings.plugins.saved.description": "{{plugin}} 설정이 성공적으로 업데이트되었습니다",
"settings.plugins.save_failed.title": "저장 실패",
"settings.plugins.save_failed.description": "{{plugin}} 설정을 업데이트할 수 없습니다",
"settings.plugins.loading": "플러그인 설정 로딩 중...",
"settings.plugins.error": "플러그인 설정을 불러올 수 없습니다",
```

#### 2k. Norwegian (`no.ts`)

```ts
"settings.plugins.title": "Plugins",
"settings.plugins.description": "Konfigurer plugin-innstillinger",
"settings.plugins.empty": "Ingen plugins med konfigurerbare innstillinger",
"settings.plugins.save": "Lagre",
"settings.plugins.saved.title": "Innstillinger lagret",
"settings.plugins.saved.description": "{{plugin}}-innstillinger oppdatert",
"settings.plugins.save_failed.title": "Kunne ikke lagre",
"settings.plugins.save_failed.description": "Kunne ikke oppdatere {{plugin}}-innstillinger",
"settings.plugins.loading": "Laster plugin-innstillinger...",
"settings.plugins.error": "Kunne ikke laste plugin-innstillinger",
```

#### 2l. Polish (`pl.ts`)

```ts
"settings.plugins.title": "Wtyczki",
"settings.plugins.description": "Konfiguracja ustawień wtyczek",
"settings.plugins.empty": "Brak wtyczek z konfigurowalnymi ustawieniami",
"settings.plugins.save": "Zapisz",
"settings.plugins.saved.title": "Ustawienia zapisane",
"settings.plugins.saved.description": "Ustawienia {{plugin}} zostały pomyślnie zaktualizowane",
"settings.plugins.save_failed.title": "Nie udało się zapisać",
"settings.plugins.save_failed.description": "Nie udało się zaktualizować ustawień {{plugin}}",
"settings.plugins.loading": "Ładowanie ustawień wtyczek...",
"settings.plugins.error": "Nie udało się załadować ustawień wtyczek",
```

#### 2m. Russian (`ru.ts`)

```ts
"settings.plugins.title": "Плагины",
"settings.plugins.description": "Настройка параметров плагинов",
"settings.plugins.empty": "Нет плагинов с настраиваемыми параметрами",
"settings.plugins.save": "Сохранить",
"settings.plugins.saved.title": "Настройки сохранены",
"settings.plugins.saved.description": "Настройки {{plugin}} успешно обновлены",
"settings.plugins.save_failed.title": "Не удалось сохранить",
"settings.plugins.save_failed.description": "Не удалось обновить настройки {{plugin}}",
"settings.plugins.loading": "Загрузка настроек плагинов...",
"settings.plugins.error": "Не удалось загрузить настройки плагинов",
```

#### 2n. Thai (`th.ts`)

```ts
"settings.plugins.title": "ปลั๊กอิน",
"settings.plugins.description": "กำหนดค่าการตั้งค่าปลั๊กอิน",
"settings.plugins.empty": "ไม่มีปลั๊กอินที่มีการตั้งค่าที่กำหนดได้",
"settings.plugins.save": "บันทึก",
"settings.plugins.saved.title": "บันทึกการตั้งค่าแล้ว",
"settings.plugins.saved.description": "อัปเดตการตั้งค่า {{plugin}} สำเร็จแล้ว",
"settings.plugins.save_failed.title": "บันทึกไม่สำเร็จ",
"settings.plugins.save_failed.description": "ไม่สามารถอัปเดตการตั้งค่า {{plugin}} ได้",
"settings.plugins.loading": "กำลังโหลดการตั้งค่าปลั๊กอิน...",
"settings.plugins.error": "โหลดการตั้งค่าปลั๊กอินไม่สำเร็จ",
```

#### 2o. Turkish (`tr.ts`)

```ts
"settings.plugins.title": "Eklentiler",
"settings.plugins.description": "Eklenti ayarlarını yapılandır",
"settings.plugins.empty": "Yapılandırılabilir ayarı olan eklenti yok",
"settings.plugins.save": "Kaydet",
"settings.plugins.saved.title": "Ayarlar kaydedildi",
"settings.plugins.saved.description": "{{plugin}} ayarları başarıyla güncellendi",
"settings.plugins.save_failed.title": "Kaydetme başarısız",
"settings.plugins.save_failed.description": "{{plugin}} ayarları güncellenemedi",
"settings.plugins.loading": "Eklenti ayarları yükleniyor...",
"settings.plugins.error": "Eklenti ayarları yüklenemedi",
```

#### 2p. Chinese Simplified (`zh.ts`)

```ts
"settings.plugins.title": "插件",
"settings.plugins.description": "配置插件设置",
"settings.plugins.empty": "没有可配置设置的插件",
"settings.plugins.save": "保存",
"settings.plugins.saved.title": "设置已保存",
"settings.plugins.saved.description": "{{plugin}} 设置已成功更新",
"settings.plugins.save_failed.title": "保存失败",
"settings.plugins.save_failed.description": "无法更新 {{plugin}} 设置",
"settings.plugins.loading": "正在加载插件设置...",
"settings.plugins.error": "加载插件设置失败",
```

#### 2q. Chinese Traditional (`zht.ts`)

```ts
"settings.plugins.title": "外掛",
"settings.plugins.description": "設定外掛選項",
"settings.plugins.empty": "沒有可設定的外掛",
"settings.plugins.save": "儲存",
"settings.plugins.saved.title": "設定已儲存",
"settings.plugins.saved.description": "{{plugin}} 設定已成功更新",
"settings.plugins.save_failed.title": "儲存失敗",
"settings.plugins.save_failed.description": "無法更新 {{plugin}} 設定",
"settings.plugins.loading": "正在載入外掛設定...",
"settings.plugins.error": "載入外掛設定失敗",
```

**Insertion point**: Her dosyada `settings.models.*` key'lerinden sonraki satıra ekle.

**QA**: `bun run typecheck` çalıştır (packages/app dizininden). Hata olmamalı.
---

### Task 3: settings-plugins.tsx oluştur (YENİ DOSYA)

**File**: `packages/app/src/components/settings-plugins.tsx`
**Action**: Create

Bu dosya mevcut settings component pattern'ini birebir takip edecek. Aşağıdaki yapıyı uygula:

#### 3a. Imports

```tsx
import { Component, For, Show, createResource, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
```

#### 3b. Type Definitions (lokal — import etme, çünkü plugin paketi app'in dependency'si değil)

```tsx
type SettingDefinition = {
  type: "string" | "number" | "boolean" | "select" | "secret"
  title: string
  description?: string
  default?: unknown
  required?: boolean
  placeholder?: string
  enum?: string[]
  enumLabels?: string[]
}

type PluginSettingsSchema = {
  id: string
  title: string
  properties: Record<string, SettingDefinition>
}

type PluginSettingsResponse = {
  schemas: PluginSettingsSchema[]
  values: Record<string, Record<string, unknown>>
}
```

#### 3c. SettingsRow (lokal tanım — mevcut pattern ile aynı)

```tsx
const SettingsRow: Component<{
  title: string | Element
  description: string | Element
  children: Element
}> = (props) => (
  <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
    <div class="flex flex-col gap-0.5 min-w-0">
      <span class="text-14-medium text-text-strong">{props.title}</span>
      <span class="text-12-regular text-text-weak">{props.description}</span>
    </div>
    <div class="flex-shrink-0">{props.children}</div>
  </div>
)
```

> **ÖNEMLİ**: JSX.Element tipi kullan (SolidJS). `Element` yerine `import { JSX } from "solid-js"` ve `JSX.Element` kullanılabilir. Mevcut dosyaların hangi pattern'i kullandığını kontrol et ve aynısını uygula.

#### 3d. API Helper (fetch wrapper)

```tsx
// globalSDK.url üzerinden fetch — auth header'ları SDK'nın ayarladığı şekilde
// ÖNCELİKLE Hono RPC client dene:
//   globalSDK.client.config["plugin-settings"].$get()
// Çalışmazsa (tip hatası verirse) fetch() fallback:
async function fetchPluginSettings(url: string): Promise<PluginSettingsResponse> {
  const res = await fetch(url + "/config/plugin-settings")
  if (!res.ok) throw new Error("Failed to fetch plugin settings")
  return res.json()
}

async function savePluginSettings(url: string, pluginId: string, settings: Record<string, unknown>) {
  const res = await fetch(url + "/config/plugin-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plugin_id: pluginId, settings }),
  })
  if (!res.ok) throw new Error("Failed to save plugin settings")
  return res.json()
}
```

> **KRİTİK AUTH NOTU**: `globalSDK` oluşturulurken auth header'ları nasıl set ediliyor kontrol et. `createSdkForServer()` → `createOpencodeClient({ baseUrl, headers: { Authorization: 'Basic ...' } })` kullanıyor. fetch() çağrısında da aynı header'ı eklemen gerekebilir. `globalSDK`'dan base URL ve auth bilgisini çek. Eğer SDK RPC client varsa (`globalSDK.client.config["plugin-settings"].$get()`) onu tercih et — auth otomatik gider.

#### 3e. PluginCard Component

Her plugin için ayrı bir kart render et. State management:

```tsx
// Her plugin için state: { values: Record<string, unknown>, dirty: boolean, saving: boolean, touched: Set<string> }
// touched: secret alanlar için — kullanıcı değiştirdiyse true, yoksa PATCH'e dahil etme
```

Render mantığı:

- Plugin title → `<h3>` olarak section header
- `<div class="bg-surface-raised-base px-4 rounded-lg">` kart container
- `<For each={Object.entries(schema.properties)}>` ile her setting için SettingsRow
- Setting tipine göre:
  - `string` → `<TextField value={...} onInput={...} placeholder={def.placeholder} />`
  - `secret` → `<TextField type="password" value={...} onInput={...} placeholder={def.placeholder ?? "••••••••"} />`
  - `number` → `<TextField type="number" value={...} onInput={...} />`
  - `boolean` → `<Switch checked={...} onChange={...} />`
  - `select` → `<Select value={...} onChange={...}>` + `<For each={def.enum}>` options (enumLabels varsa label olarak kullan)
- Save butonu: `<Button onClick={handleSave} disabled={!dirty || saving}>{language.t("settings.plugins.save")}</Button>`

**Secret alan kuralı**: `touched` set'inde yoksa PATCH payload'ına dahil ETME. Kullanıcı alana yazdığında `touched`'a ekle. Initial değer olarak boş string göster (server'dan gelen değeri gösterme).

#### 3f. Ana Component

```tsx
export const SettingsPlugins: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()

  const [data, { refetch }] = createResource(() => fetchPluginSettings(globalSDK.url))

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      {/* Sticky header */}
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.plugins.title")}</h2>
          <p class="text-12-regular text-text-weak">{language.t("settings.plugins.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <Show when={data.loading}>
          <p class="text-12-regular text-text-weak">{language.t("settings.plugins.loading")}</p>
        </Show>
        <Show when={data.error}>
          <p class="text-12-regular text-text-weak">{language.t("settings.plugins.error")}</p>
        </Show>
        <Show when={data()}>
          {(resolved) => (
            <Show
              when={resolved().schemas.length > 0}
              fallback={<p class="text-12-regular text-text-weak">{language.t("settings.plugins.empty")}</p>}
            >
              <For each={resolved().schemas}>
                {(schema) => (
                  <PluginCard
                    schema={schema}
                    values={resolved().values[schema.id] ?? {}}
                    url={globalSDK.url}
                    refetch={refetch}
                  />
                )}
              </For>
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}
```

**QA**:

- `bun run typecheck` (packages/app) → hatasız geçmeli
- Her setting tipi (string, number, boolean, select, secret) için doğru input render edildiğini koda bakarak doğrula
- Secret alanların PATCH'e dahil edilip edilmediğini handleSave fonksiyonunda kontrol et

---

### Task 4: dialog-settings.tsx güncelle

**File**: `packages/app/src/components/dialog-settings.tsx`
**Action**: Edit

#### 4a. Import ekle (satır 10, SettingsModels import'undan sonra)

```tsx
import { SettingsPlugins } from "./settings-plugins"
```

#### 4b. Tab trigger ekle (Server section, Models trigger'dan sonra — satır 47'den sonra)

Mevcut yapı:

```tsx
<Tabs.Trigger value="models">
  <Icon name="models" />
  {language.t("settings.models.title")}
</Tabs.Trigger>
```

Bundan SONRA, `</div>` kapanmadan ÖNCE ekle:

```tsx
<Tabs.Trigger value="plugins">
  <Icon name="mcp" />
  {language.t("settings.plugins.title")}
</Tabs.Trigger>
```

#### 4c. Tab content ekle (Models content'den sonra — satır 69'dan sonra)

Mevcut yapı:

```tsx
<Tabs.Content value="models" class="no-scrollbar">
  <SettingsModels />
</Tabs.Content>
```

Bundan SONRA ekle:

```tsx
<Tabs.Content value="plugins" class="no-scrollbar">
  <SettingsPlugins />
</Tabs.Content>
```

**QA**:

- `bun run typecheck` (packages/app) → hatasız geçmeli
- dialog-settings.tsx'te tab sırası: General, Shortcuts | Providers, Models, Plugins

---

### Task 5: Typecheck & Build doğrulama

**Action**: Run commands

```bash
# packages/app typecheck
cd packages/app && bun run typecheck

# packages/app build
cd packages/app && bun run build

# Tüm repo typecheck (opsiyonel ama önerilen)
bun turbo typecheck
```

Hepsi exit code 0 ile tamamlanmalı.

---

## Final Verification Wave

Tüm task'lar tamamlandıktan sonra:

1. **Console temizliği**: `git diff dev -- packages/console/` → boş çıkmalı
2. **App typecheck**: `cd packages/app && bun run typecheck` → exit 0
3. **App build**: `cd packages/app && bun run build` → exit 0
4. **Manuel doğrulama** (mümkünse):
   - Backend: `cd packages/opencode && bun run --conditions=browser ./src/index.ts serve --port 4096`
   - App: `cd packages/app && bun dev -- --port 4444`
   - `http://localhost:4444` aç → Settings → Plugins tab görünmeli
   - Plugin schema'ları varsa dinamik form render edilmeli

## Scope OUT (yapılmayacak)

- Plugin enable/disable toggle
- Validation (required field kontrolü)
- "Unsaved changes" confirmation dialog
- Global save (per-plugin save yeterli)
- Search/filter plugin'ler
- Yeni CSS modülleri (inline Tailwind class'lar yeterli)
- ~~Diğer dillere i18n çeviri~~ → Task 2'de tüm 17 dil kapsanıyor ✅
