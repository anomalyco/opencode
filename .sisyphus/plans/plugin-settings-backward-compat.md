# Plugin Settings Geriye Dönük Uyumluluk

> **Hedef**: Mevcut plugin config dosyalarını (oh-my-opencode.json, dcp.jsonc vb.) yeni merkezi `plugin_settings` sistemiyle entegre et.  
> **Kapsam**: 7 iş akışı (WS0: PR review düzeltmeleri + WS1-WS6), 9 mevcut plugin'in hiçbirinin bozulmaması garantisiyle.
> **Kapsam DIŞI**: Plugin'lerin kendi config okuma kodlarını değiştirmek (plugin yazarlarının sorumluluğu), keychain/OS secure store entegrasyonu, UI'da tam özellikli JSON editör (MVP'de read-only/basit editor yeterli).

## Mimari Genel Bakış

```
┌─────────────────────────────────────────────────────┐
│                    Plugin Loader                     │
│                                                      │
│  1. Plugin yüklenir (import)                         │
│  2. hook.settings? → schema topla                    │
│  3. hook.legacyConfig? → legacy dosya keşfet (YENİ)  │
│  4. plugin_settings'den değer oku                    │
│  5. Global + Proje merge (YENİ)                      │
│  6. PluginInput.settings olarak inject et (YENİ)     │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│              Config Persistence Layer                │
│                                                      │
│  Global: ~/.config/opencode/opencode.json            │
│  Proje:  .opencode/opencode.json                     │
│  Merge:  deep-merge, array=replace, proje>global     │
│  Secret: global-only (proje'ye yazım engellenir)     │
└─────────────────────────────────────────────────────┘
```

## Referans Dosyalar

| Dosya                                              | Rol                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/plugin/src/index.ts`                     | SettingDefinition, PluginInput, Hooks, PluginSettingsSchema tipleri |
| `packages/opencode/src/plugin/index.ts`            | Plugin yükleyici, schemas(), init(), trigger()                      |
| `packages/opencode/src/config/config.ts`           | Config schema (z.object), merge, read/update                        |
| `packages/opencode/src/server/routes/config.ts`    | GET/PATCH /config/plugin-settings API                               |
| `packages/app/src/components/settings-plugins.tsx` | Plugin ayarları UI                                                  |

## Tasarım Kararları

| Karar                 | Seçim                          | Gerekçe                                          |
| --------------------- | ------------------------------ | ------------------------------------------------ |
| Uyumluluk stratejisi  | Kademeli göç                   | Plugin'ler kırılmamalı; legacy dosyalar korunur  |
| Discovery yöntemi     | hooks.legacyConfig + whitelist | Genel tarama false-positive üretir               |
| Nested tip desteği    | object + array                 | oh-my-opencode agents/categories temsil edilmeli |
| Array merge semantiği | Replace (concat değil)         | Öngörülebilir davranış                           |
| Secret yazım kapsamı  | Global-only                    | Proje repo'suna credential sızmasını engelle     |
| Legacy dosya silme    | Asla otomatik silme            | Plugin'lerin eski okuyucuları bozulmasın         |
| Persistence hedefi    | Mevcut config dosyasına patch  | config.json üretme gotcha'sını çöz               |

## Sıralama ve Bağımlılıklar

```
WS0 (PR Review Düzeltmeleri) ────────────┐
WS1 (Tip Sistemi) ──────────────────────┤
WS2 (PluginInput.settings) ─────────────┤
WS3 (Legacy Discovery hooks) ───────────┼──▶ WS6 (UI)
WS4 (Migration Utility) ────────────────┤
WS5 (Scope-Aware Persistence) ──────────┘
```

WS0 bağımsız olarak ilk başlatılabilir (mevcut kodun düzeltilmesi). WS1-WS5 paralel başlanabilir, WS6 hepsine bağımlı.

### Momus İnceleme Notları (Yüksek Doğruluk)

> **Sonuç**: [OKAY] — Plan uygulanabilir. Aşağıdaki uyarılar dikkate alınmalı:
>
> 1. **WS0 UI görevleri**: `createSignal`/global error state varsayımları mevcut UI koduyla birebir eşleşmeyebilir. Geliştirici ilgili dosyadan başlayıp mevcut pattern'e göre uyarlamalı.
> 2. **Plugin ID eşleme**: Plan plugin paketi adını ID olarak kullanıyor. Loader şu an hooks'u düz array'de tutuyor, pluginId ile eşleme yok. Loader'da `currentPluginSpec` tracking'i eklenip hooks ile ilişkilendirilmeli.
> 3. **`Config.update()` gotcha'sı**: Mevcut update `Instance.directory/config.json`'a yazıyor — scope-aware persistence (WS5) bunu çözmeli, geliştirici bu gotcha'dan haberdar olmalı.
> 4. **`plugin-settings-section.tsx` vs `settings-plugins.tsx`**: PR'da `plugin-settings-section.tsx` adı geçiyor ama repoda `settings-plugins.tsx` mevcut. Geliştirici mevcut dosya adını kullanmalı.

---

## WS0: PR #15514 Bot Review Düzeltmeleri (Copilot)

> Bu workstream, mevcut plugin settings kodundaki Copilot tarafından tespit edilen 7 sorunu düzeltir.
> PR: https://github.com/anomalyco/opencode/pull/15514
> Diğer WS'lerden bağımsız olarak ilk başlatılabilir.

### Görev
- [x] 0.1: Hata durumunu plugin bazında izle (Global error state)

**Dosya**: `packages/app/src/components/settings-plugins.tsx` (veya `plugin-settings-section.tsx`)

**Sorun**: `error` tek bir global signal olarak tanımlı. Bir plugin kaydetme başarısız olduğunda hata mesajı TÜM plugin kartlarında görünüyor.

**Düzeltme**: `saving` signal'ı gibi `error`'ı da `Record<string, string | null>` yapısına çevir — her `pluginId` için ayrı hata durumu tut.

```ts
// Mevcut (yanlış):
const [error, setError] = createSignal<string | null>(null)

// Düzeltme:
const [errors, setErrors] = createSignal<Record<string, string | null>>({})
// Kullanım: errors()[pluginId] ile ilgili plugin kartına göster
```

**QA**: Bir plugin hata verdiğinde sadece o kartın altında hata mesajı görünmeli, diğer kartlar etkilenmemeli. Manuel UI testi.

### Görev
- [x] 0.2: API yanıtında schema validasyonu (No schema validation)

**Dosya**: `packages/app/src/components/settings-plugins.tsx`

**Sorun**: `GET /config/plugin-settings` yanıtı hiç valide edilmiyor. Bozuk bir plugin schema'sı `Object.entries(schema.properties)` satırında tüm sayfayı çökertebilir.

**Düzeltme**:
1. API yanıtını client-side'da Zod ile valide et
2. Geçersiz schema'ları sessizce atla (skip) veya "Bu plugin'in ayar şeması geçersiz" mesajıyla işaretle
3. Bir plugin'in bozuk schema'sı diğer plugin'lerin render edilmesini engellemememeli

```ts
// Her schema için güvenli erişim:
for (const schema of schemas) {
  if (!schema.properties || typeof schema.properties !== "object") {
    console.warn(`Geçersiz schema: ${schema.id}`)
    continue
  }
  // render...
}
```

**QA**: Bozuk schema (properties: null veya undefined) geldiğinde sayfa çökmemeli, diğer plugin'ler normal render edilmeli.

### Görev
- [x] 0.3: PATCH endpoint'inde settings merge (Overwrite vs Merge)

**Dosya**: `packages/opencode/src/server/routes/config.ts`

**Sorun**: `PATCH /config/plugin-settings` gönderilen settings'i plugin'in mevcut settings'inin ÜZERİNE yazıyor. Sadece bir subset gönderildiğinde daha önce kaydedilmiş key'ler siliniyor.

**Düzeltme**: Server-side'da shallow merge uygula:

```ts
// Mevcut (yanlış):
config.plugin_settings[body.plugin_id] = body.settings

// Düzeltme:
config.plugin_settings[body.plugin_id] = {
  ...config.plugin_settings?.[body.plugin_id],
  ...body.settings
}
```

**QA**:
- Birim test: mevcut `{a: 1, b: 2}` + patch `{b: 3}` → sonuç `{a: 1, b: 3}` (a korunmalı)
- Birim test: mevcut `{}` + patch `{a: 1}` → sonuç `{a: 1}`
- `bun --cwd packages/opencode test` çıkış kodu 0

### Görev
- [x] 0.4: OpenAPI schema'sını güçlendir (Weak schema)

**Dosya**: `packages/opencode/src/server/routes/config.ts`

**Sorun**: GET yanıtının schema tanımı `z.array(z.unknown())` kullanıyor — SDK ve otomatik validasyon için yetersiz.

**Düzeltme**: `PluginSettingsSchema` ve `SettingDefinition` için Zod schema'sı tanımla ve OpenAPI endpoint'inde kullan:

```ts
const settingDefinitionSchema = z.object({
  type: z.enum(["string", "number", "boolean", "select", "secret", "object", "array"]),
  title: z.string(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  enum: z.array(z.string()).optional(),
  enumLabels: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.lazy(() => settingDefinitionSchema)).optional(),
  items: z.lazy(() => settingDefinitionSchema).optional(),
})

const pluginSettingsSchemaZod = z.object({
  id: z.string(),
  title: z.string(),
  properties: z.record(z.string(), settingDefinitionSchema),
})
```

**Not**: Bu Zod schema'sı WS1'deki object/array tip genişletmesiyle uyumlu olmalı. WS1 ile koordineli çalışılmalı.

**QA**: `bun ./packages/sdk/js/script/build.ts` çıkış kodu 0. SDK'da tipler doğru yansımalı.

### Görev
- [x] 0.5: SettingDefinition'ı discriminated union'a çevir (Type safety)

**Dosya**: `packages/plugin/src/index.ts`

**Sorun**: Mevcut flat tip `type: "select"` ama `enum` olmadan geçersiz kombinasyonlara izin veriyor. Compile-time güvenliği yok.

**Düzeltme**: `type` alanına göre discriminated union kullan:

```ts
type SettingBase = {
  title: string
  description?: string
  required?: boolean
}

type StringSetting = SettingBase & {
  type: "string"
  default?: string
  placeholder?: string
}

type NumberSetting = SettingBase & {
  type: "number"
  default?: number
  placeholder?: string
}

type BooleanSetting = SettingBase & {
  type: "boolean"
  default?: boolean
}

type SelectSetting = SettingBase & {
  type: "select"
  enum: string[]           // ZORUNLU
  enumLabels?: string[]
  default?: string
}

type SecretSetting = SettingBase & {
  type: "secret"
  placeholder?: string
}

type ObjectSetting = SettingBase & {
  type: "object"
  properties?: Record<string, SettingDefinition>  // tanımlıysa structured, yoksa free-form
  default?: Record<string, unknown>
}

type ArraySetting = SettingBase & {
  type: "array"
  items?: SettingDefinition  // tanımlıysa typed, yoksa free-form
  default?: unknown[]
}

type SettingDefinition = StringSetting | NumberSetting | BooleanSetting | SelectSetting | SecretSetting | ObjectSetting | ArraySetting
```

**UYARI**: Bu değişiklik WS1 Görev 1.1 ile birleştirilmeli. Görev 1.1 sadece `object`/`array` ekliyordu, bu görev tüm tipi discriminated union'a çeviriyor. **Bu görev (0.5) öncelikli** — Görev 1.1'in ayrıca yapılmasına gerek kalmaz, bu görev onu kapsar.

**QA**: `bun --cwd packages/plugin tsc --noEmit` çıkış kodu 0. `type: "select"` ama `enum` olmadan tanımlama compile error vermeli.

### Görev
- [x] 0.6: Number input NaN/empty handling düzelt

**Dosya**: `packages/app/src/components/settings-plugins.tsx`

**Sorun**: Number input'ta boş string `0`'a dönüşüyor, geçersiz input `NaN` üretiyor. Kullanıcı "unset" yapamıyor.

**Düzeltme**:
```ts
// Mevcut (yanlış):
onChange={(e) => update(pluginId, key, Number(e.target.value))}

// Düzeltme:
onChange={(e) => {
  const raw = e.target.value
  if (raw === "") return update(pluginId, key, undefined)
  const num = Number(raw)
  if (Number.isNaN(num)) return  // geçersiz girişi yok say
  update(pluginId, key, num)
}}
```

**QA**: Manuel UI testi: boş bırakıldığında değer `undefined` olmalı (0 değil). "abc" girildiğinde NaN kaydedilmemeli.

### Görev
- [x] 0.7: Erişilebilirlik (Accessibility) düzeltmeleri

**Dosya**: `packages/app/src/components/settings-plugins.tsx`

**Sorun**: `<label>` etiketleri `<input>` elemanlarıyla programatik olarak ilişkilendirilmemiş (htmlFor/id yok, aria-labelledby yok). Ekran okuyucular form alanlarını tanımlayamıyor.

**Düzeltme**: Her ayar alanı için benzersiz `id` oluştur ve label'ı ilişkilendir:

```tsx
// Her setting field için:
const fieldId = `plugin-setting-${pluginId}-${key}`

<label htmlFor={fieldId}>{setting.title}</label>
<input id={fieldId} ... />
```

- Select, checkbox, textarea vb. tüm input tipleri için aynı pattern uygulanmalı
- Secret alanları için `aria-describedby` ile "gizli alan" ipucu eklenebilir

**QA**: Her input elemanının ilişkili bir label'ı olmalı. Tarayıcı DevTools ile kontrol: her input'un id'si var ve eşleşen htmlFor'lu label mevcut.

---

## WS1: Tip Sistemi Genişletme

### ~~Görev 1.1: SettingDefinition'a `object` ve `array` tipleri ekle~~

> **BU GÖREV İPTAL EDİLDİ** — WS0 Görev 0.5 (discriminated union) bu görevi tamamen kapsar.
> Görev 0.5'te `ObjectSetting` ve `ArraySetting` tipleri zaten tanımlanmıştır.
> Ayrıca yapılmasına gerek yoktur.

### Görev
- [x] 1.2: Config schema'da plugin_settings tipini güncelle (doğrulama)
### Görev
- [x] 1.2: Config schema'da plugin_settings tipini güncelle

**Dosya**: `packages/opencode/src/config/config.ts`

**Değişiklik**: Mevcut `plugin_settings` zaten `z.record(z.string(), z.record(z.string(), z.unknown()))` — nested değerleri kabul ediyor, değişiklik gerekmez. Sadece doğrula.

**QA**: Mevcut testler geçer.

---

## WS2: PluginInput'a Settings Enjeksiyonu

### Görev
- [x] 2.1: PluginInput tipine `settings` alanı ekle

**Dosya**: `packages/plugin/src/index.ts`

**Değişiklik**: `PluginInput` tipine ekle:

```ts
// PluginInput'a eklenecek alan:
settings: Record<string, unknown>
```

Bu, ilgili plugin'in `plugin_settings[pluginId]` değerlerini taşır. Plugin yüklenirken henüz değer yoksa `{}` gönderilir.

**QA**: `bun --cwd packages/plugin tsc --noEmit` çıkış kodu 0.

### Görev
- [x] 2.2: Plugin loader'da settings inject et

**Dosya**: `packages/opencode/src/plugin/index.ts`

**Değişiklik**: Plugin yüklenirken (her plugin fonksiyonu çağrılırken) `PluginInput`'a settings değerlerini ekle:

1. `Config.get()` ile mevcut config'i al
2. Plugin ID'sine göre `config.plugin_settings?.[pluginId] ?? {}` değerini bul
3. Bu değeri `PluginInput.settings` olarak plugin fonksiyonuna geçir

**Plugin ID belirleme**: Plugin paketi adı (npm scope dahil) plugin ID olarak kullanılır. Yerel path plugin'ler için `package.json#name` okunur, yoksa dizin adı kullanılır.

**QA**: Bir test plugin'i oluşturup settings'in doğru iletildiğini doğrula. `bun --cwd packages/opencode test` çıkış kodu 0.

---

## WS3: Legacy Config Discovery

### Görev
- [x] 3.1: `legacyConfig` hook tanımı ekle

**Dosya**: `packages/plugin/src/index.ts`

**Değişiklik**: `Hooks` arayüzüne yeni opsiyonel hook ekle:

```ts
// Hooks'a eklenecek:
legacyConfig?: {
  files: Array<{
    path: string        // Dosya yolu (mutlak veya Global.Path.config'e göreceli)
    format: "json" | "jsonc" | "yaml" | "toml"
    scope: "global" | "project"
  }>
  migrate: (raw: unknown) => Record<string, unknown>  // Legacy formatı → flat settings'e dönüştür
}
```

**Tasarım notu**: `migrate` fonksiyonu plugin yazarının sorumluluğu — legacy yapıyı (nested, farklı key isimleri vb.) plugin_settings formatına dönüştürür. Opencode sadece dosyayı okuyup bu fonksiyona verir.

**QA**: `bun --cwd packages/plugin tsc --noEmit` çıkış kodu 0.

### Görev
- [x] 3.2: Plugin loader'da legacyConfig hook'unu işle

**Dosya**: `packages/opencode/src/plugin/index.ts`

**Değişiklik**: Plugin init sırasında (schema toplama aşamasında):

1. `hook.legacyConfig` varsa:
   - Her `file` girişi için dosyanın varlığını kontrol et (`Bun.file(path).exists()`)
   - Dosya varsa, formatına göre parse et (JSON/JSONC: `JSON.parse` / `jsonc-parser`, YAML: gerekirse ek bağımlılık, TOML: aynı şekilde)
   - Parse edilen veriyi `hook.legacyConfig.migrate(raw)` ile dönüştür
   - Dönüştürülen değerleri **sadece `plugin_settings` boşsa** (ilgili plugin ID altında) config'e yaz
2. Legacy dosya algılandığında ve migration yapıldığında `console.log` ile bilgi mesajı yazdır
3. Legacy dosyayı **asla silme veya taşıma** — plugin eski okuyucusuna hâlâ bağımlı olabilir

**İdempotency kuralı**: `plugin_settings[pluginId]` zaten doluysa migration ÇALIŞMAZ. Bu, kullanıcının merkezi ayarları değiştirdikten sonra legacy'nin ezme riskini ortadan kaldırır.

**QA**:
- Birim test: legacy dosya var + plugin_settings boş → migration çalışır
- Birim test: legacy dosya var + plugin_settings dolu → migration çalışmaz (idempotent)
- Birim test: legacy dosya yok → hatasız devam
- `bun --cwd packages/opencode test` çıkış kodu 0

---

## WS4: Migration Utility

### Görev
- [x] 4.1: JSONC parser desteği ekle

**Dosya**: `packages/opencode/src/plugin/index.ts` (veya yeni dosya: `packages/opencode/src/plugin/legacy.ts`)

**Değişiklik**: Legacy config dosyaları JSONC formatında olabilir (dcp.jsonc, oh-my-opencode.jsonc). JSONC parse desteği gerekli.

**Kontrol et**: Codebase'de zaten JSONC parse kullanılıyor mu? (opencode.jsonc desteği mevcut olabilir — Config loader'ı incele). Mevcut parse mekanizması kullanılabilirse yeni bağımlılık ekleme.

**QA**: JSONC dosya (yorumlu, trailing comma) parse edilebiliyor.

### Görev
- [x] 4.2: Migration fonksiyonu uygula

**Dosya**: `packages/opencode/src/plugin/legacy.ts` (yeni dosya)

**Değişiklik**: Legacy discovery ve migration mantığını kapsülleyen modül:

```ts
// Fonksiyon imzası:
async function discover(hooks: Hooks[], configDir: string, projectDir: string): Promise<Record<string, Record<string, unknown>>>
```

1. Her hook'un `legacyConfig` tanımını al
2. `files` listesindeki her dosyayı oku ve parse et
3. `migrate()` ile dönüştür
4. Scope'a göre (global/project) ayrı ayrı topla
5. Sonucu `Record<pluginId, settings>` olarak döndür

**Hata yönetimi**: JSONC parse hatası → `console.warn` ile kullanıcıya net mesaj, o plugin atlanır (fail-safe, tüm sistem çökmez).

**QA**:
- Birim test: geçerli JSONC → doğru dönüşüm
- Birim test: bozuk JSONC → uyarı mesajı, plugin atlanır
- Birim test: boş dosya → boş nesne
- `bun --cwd packages/opencode test` çıkış kodu 0

---

## WS5: Scope-Aware Persistence (Global + Proje Katmanlı Config)

### Görev
- [x] 5.1: Config merge'de plugin_settings katmanlamasını doğrula

**Dosya**: `packages/opencode/src/config/config.ts`

**Değişiklik**: Mevcut config merge sistemi (`remeda.mergeDeep`) `plugin_settings`'i de katmanlıyor olmalı — global config'teki plugin_settings + proje config'teki plugin_settings birleşir.

**Doğrulanacak davranış**:
- Global'de `plugin_settings.oh-my-opencode.theme = "dark"` + Proje'de `plugin_settings.oh-my-opencode.theme = "light"` → Sonuç: `"light"` (proje kazanır)
- Global'de `plugin_settings.oh-my-opencode.agents = {a: true}` + Proje'de tanımsız → Sonuç: `{a: true}` (global korunur)
- **Array merge: REPLACE semantiği** — global'deki array proje'deki ile tamamen değiştirilir, concat yapılmaz

**Eğer mevcut deep-merge array'leri concat ediyorsa**: `plugin_settings` altındaki array'ler için özel davranış ekle — array gördüğünde replace et.

**QA**: Birim test: global+proje merge senaryoları (override, fallback, array replace). `bun --cwd packages/opencode test`

### Görev
- [x] 5.2: PATCH endpoint'ine `scope` parametresi ekle

**Dosya**: `packages/opencode/src/server/routes/config.ts`

**Değişiklik**: `PATCH /config/plugin-settings` body'sine `scope` ekle:

```ts
// Mevcut body:
{ plugin_id: string, settings: Record<string, unknown> }

// Yeni body:
{ plugin_id: string, settings: Record<string, unknown>, scope?: "global" | "project" }
```

**Davranış**:
- `scope = "project"` (varsayılan): Proje config dosyasına yaz (`.opencode/opencode.json`)
- `scope = "global"`: Global config dosyasına yaz (`~/.config/opencode/opencode.json`)
- **Secret guard**: `type: "secret"` olan ayarlar `scope = "project"` ile yazılmaya çalışılırsa hata döndür (400). Secret'lar sadece global'e yazılabilir.

**Persistence hedefi**: `Config.update()` yerine scope'a göre doğru dosyayı bul ve patch uygula. Mevcut dosya formatını koru (JSONC ise JSONC olarak yaz — `jsonc-parser` edit API'si kullanılabilir).

**QA**:
- API testi: scope=project → proje dosyası güncellenir
- API testi: scope=global → global dosya güncellenir
- API testi: secret + scope=project → 400 hata
- `bun --cwd packages/opencode test` çıkış kodu 0

### Görev
- [x] 5.3: GET endpoint'inde katmanlı değerleri döndür

**Dosya**: `packages/opencode/src/server/routes/config.ts`

**Değişiklik**: `GET /config/plugin-settings` yanıtını zenginleştir:

```ts
// Mevcut yanıt:
{ schemas: PluginSettingsSchema[], values: Record<string, Record<string, unknown>> }

// Yeni yanıt:
{
  schemas: PluginSettingsSchema[],
  values: Record<string, Record<string, unknown>>,  // merged (proje > global)
  global: Record<string, Record<string, unknown>>,  // sadece global değerler
  project: Record<string, Record<string, unknown>>  // sadece proje değerler
}
```

Bu sayede UI hangi değerin nereden geldiğini gösterebilir ve scope seçici sunabilir.

**QA**: API testi: global+proje ayrı ayrı ve merged doğru dönüyor. `bun --cwd packages/opencode test`

---

## WS6: UI Güncellemeleri

### Görev
- [x] 6.1: Nested tip desteği (object/array) için UI renderer

**Dosya**: `packages/app/src/components/settings-plugins.tsx`

**Değişiklik**: Mevcut UI sadece flat tipleri (string input, number input, boolean toggle, select dropdown, secret masked input) render ediyor.

**MVP yaklaşımı**:
- `type: "object"` → İç içe alan varsa (`properties` tanımlıysa) her alt alanı ayrı form elemanı olarak render et (recursive). `properties` yoksa read-only JSON bloğu göster.
- `type: "array"` → `items` tanımlıysa listelenebilir form (ekle/sil butonlu). `items` yoksa read-only JSON bloğu göster.
- İlk iterasyonda karmaşık nested editing gerek yok — serbest-form nesneler için basit `<textarea>` + JSON validation yeterli.

**QA**: Manuel UI testi: object ve array tipinde ayarlar doğru render ediliyor, düzenleme yapılabiliyor.

### Görev
- [x] 6.2: Scope seçici ekle

**Dosya**: `packages/app/src/components/settings-plugins.tsx`

**Değişiklik**: Her plugin ayar grubu üzerinde scope göstergesi ekle:

- Her ayar alanının yanında küçük badge: "Global" veya "Proje"
- Değerin nereden geldiğini göstermek için: proje override varsa "Proje (global'i eziyor)" ibaresi
- Kaydetme sırasında scope seçimi: varsayılan proje, global'e kaydetmek için açık seçim
- Secret alanlarında scope seçici devre dışı — her zaman global

**QA**: Manuel UI testi: scope badge'leri doğru gösteriliyor, secret alanları global-only.

### Görev
- [x] 6.3: Legacy migration bildirim banner'ı

**Dosya**: `packages/app/src/components/settings-plugins.tsx`

**Değişiklik**: Eğer bir plugin'in legacy config dosyası algılandıysa ve migration yapıldıysa, UI'da bilgi banner'ı göster:

- "Bu plugin'in eski config dosyası (oh-my-opencode.json) algılandı ve ayarları buraya taşındı. Eski dosyayı silmenize gerek yok; plugin onu kullanmaya devam edebilir."
- Banner kapatılabilir (dismissable)

**Not**: Bu banner için backend'den migration durumu bilgisi gelmeli. GET endpoint'ine `migrated: string[]` (migrate edilmiş plugin ID'leri) alanı eklenebilir, ya da bu bilgi frontend'de algılanabilir (values var ama schema'da settings hook yok = migrated).

**QA**: Manuel UI testi: migration yapılmış plugin'de banner görünüyor.

---

## Final Verification Wave

> Tüm görevler tamamlandıktan sonra çalıştırılacak doğrulama adımları.

### Doğrulama 1: Unit Testler

```bash
bun --cwd packages/opencode test
```

- **Assert**: Çıkış kodu 0
- **Kapsam**: Migration idempotency, merge precedence, array replace, secret scope enforcement

### Doğrulama 2: Tip Kontrolü

```bash
bun --cwd packages/opencode tsc --noEmit
bun --cwd packages/plugin tsc --noEmit
```

- **Assert**: Çıkış kodu 0, yeni tipler tüm kullanım noktalarında uyumlu

### Doğrulama 3: SDK Yenileme

```bash
bun ./packages/sdk/js/script/build.ts
```

- **Assert**: Çıkış kodu 0, yeni API şeması SDK'ya yansımış

### Doğrulama 4: Backend API Kontrat Testi

```bash
# Server başlat (arka planda)
bun --cwd packages/opencode run --conditions=browser ./src/index.ts serve --port 4096 &
sleep 3

# Schema + values dönüyor mu
curl -s http://localhost:4096/config/plugin-settings | jq -r '(.schemas|type),(.values|type)'
# Assert: "array" ve "object"

# Nested settings patch
curl -s -X PATCH http://localhost:4096/config/plugin-settings \
  -H 'content-type: application/json' \
  -d '{"plugin_id":"test-plugin","settings":{"nested":{"key":"value"}}}' \
  | jq -r '.ok'
# Assert: true

# Scope parametresi
curl -s -X PATCH http://localhost:4096/config/plugin-settings \
  -H 'content-type: application/json' \
  -d '{"plugin_id":"test-plugin","settings":{"foo":"bar"},"scope":"global"}' \
  | jq -r '.ok'
# Assert: true
```

### Doğrulama 5: Build

```bash
bun --cwd packages/opencode build
bun --cwd packages/app build
```

- **Assert**: Çıkış kodu 0
