# Rollover — Unified Implementation Specification (reference copy)

> Bu dosya, oturumda verilmiş olan iki spec dokümanının birleştirilmiş referans kopyasıdır.

> **v2 amendment (2026-11-19) — the deterministic swap.** Part A §8.3's
> decision table is superseded on one point: the swap no longer contains an
> LLM call in any path, and the safe-point's extraction condition
> (`extractedUntilMessageId === son assistant mesajı` + not inflight) is
> withdrawn — the swap fires from state alone. §8.5's render is superseded
> by the mechanical projection (`core/projection.ts`: user prompts verbatim,
> assistant first-lines, files touched, then the packer sections; ledger
> records positionally scoped to the discarded region). §7.1's extraction
> gate is withdrawn (idle extraction runs each turn; `ledger: false` = no
> extraction). Consolidation's §7.5 semantics and the §1 behavior contract
> survive unchanged. Implementation decisions: `docs/decisions.md` D11/D12;
> rationale: `docs/2026-11-19-deterministic-swap-design.md`.
> Plan (`docs/superpowers/plans/2026-11-15-rollover-opencode.md`) bu belgeye atıfta bulunur.
> Not: Spec 1.x plugin API varsayımlarıyla yazılmıştır; plan, fork 2.3.0'daki karşılıklarla
> birlikte uygulanır (bkz. plan bölümü "OpenCode fork 2.3.0 surface map").

---

# Part A — Rollover: Implementasyon Spec (OpenCode MVP)

Bu doküman bir coding agent'a verilir ve tek başına yeterlidir. Tasarım kararları kesinleşmiştir: agent karar vermez, uygular. Belirsizlik için §0.3'e bak.

## 0. Agent için çalışma kuralları

### 0.1 Dil ve terimler
MUST ve MUST NOT zorunlu, SHOULD güçlü öneri, MAY isteğe bağlıdır. Kod, dosya ve identifier adları İngilizce yazılır. Kullanıcıya görünen mesajlar İngilizcedir ve tek yerde tutulur (src/core/messages.ts). Modele giden metinler (render, prompt'lar) İngilizcedir; ledger kayıtları da İngilizce üretilir.

### 0.2 Çalışma sırası
Fazlar §14'teki sırayla ilerler (M0 → M8). Bir fazın testleri geçmeden sonrakine geçme. Faz 0 (spike) bitmeden src/core dışında kod yazma.

### 0.3 Belirsizlikte
1. Bu dokümandaki kural her zaman kazanır.
2. Dokümanda yoksa en basit çözümü seç ve docs/decisions.md'ye tek satır yaz (karar + gerekçe).
3. §1'deki sözleşmeyi bozan çözüm seçme.
4. OpenCode beklenenden farklı davranırsa kodu `// ASSUMPTION(P0-n)` ile işaretle, §2.2'deki fallback'i uygula ve bulguyu docs/phase0-findings.md'ye yaz.

### 0.4 Teslim edilecekler
Çalışan plugin, testler (§12), benchmark harness'ı ve benchmark raporu (§13), kurulum ve komutları anlatan README.md.

## 1. Davranış sözleşmesi (değişmez)

Context eşiği aşıldıysa ve güvenli noktadaysak, bir sonraki gerçek kullanıcı mesajında, modele giden eski geçmiş ledger özetiyle değiştirilir. Her zaman. İstisnasız.

1. Swap deterministiktir ve LLM çağrısı içermez. Kullanıcı mesajı gönderdikten sonra rollover kaynaklı gecikme hedef < 250 ms, kesin üst sınır 5 sn'dir (test ile korunur).
2. Ledger, rollover öncesinde ne ana modele ne extraction modeline girer. Extraction girdisi yalnızca o turun delta'sıdır.
3. Rollover kullanıcı akışını asla bozmaz: herhangi bir hata → rollover atlanır, mesajlar değiştirilmeden bırakılır, hata loglanır.
4. UI, session ID ve DB'deki mesaj geçmişi değişmez. Yalnızca modele giden liste değişir.
5. tool_use / tool_result çiftleri asla koparılmaz. Swap sonrası model-facing listede eski tool part'ı yoktur; kalan mesajlar bütündür.
6. Her rollover'da kullanıcıya toast gösterilir. Sessiz değişiklik yok.
7. Harness'ın kendi compaction'ına dokunulmaz.
8. src/core hiçbir harness paketini import etmez.

MVP'de bilerek yok (ekleme): devam/yeni-task classifier'ı, sert eşik (×1.3), %85 acil fallback, /rollover now ve /rollover skip, BLOCKED durumu ve process timeout'u, embedding/retrieval, extraction'ı alt eşiğe kadar erteleme.

## 2. OpenCode yüzeyi ve Faz 0

### 2.1 Kullanılacak yüzey

| Yüzey | Kullanım | Güven |
|---|---|---|
| Plugin yükleme | `.opencode/plugins/rollover.ts` veya npm paketi. İmza: `Plugin = async ({ project, client, $, directory, worktree }) => hooks` | Dokümante |
| event hook | `message.updated` (assistant usage), `session.idle`, `session.deleted`, `session.compacted` | Dokümante |
| chat.params | `input.model.limit.context` ile model context limiti | Üçüncü parti plugin'lerde gözlemlendi |
| `experimental.chat.messages.transform(input, output)` | Modele gitmeden önce mesaj listesi. `output.messages` canlı payload'dır: yerinde değiştir (splice), atama güvenilmez. Bazı sürümlerde input boştur | Experimental, sürüme göre değişir |
| `tool.execute.before/after` | Dokunulan dosyaların izlenmesi | Dokümante |
| config hook ve tool | Komut kaydı ve rollover_ctl custom tool'u | Dokümante |
| client SDK | session.messages/get/create/prompt/abort/delete, tui.showToast | P0'da doğrula |

OpenCode sürümünü sabitle ve `opencode --version` çıktısını docs/phase0-findings.md ile benchmark raporuna yaz. Experimental hook'lar sürümler arasında değişebilir.

### 2.2 Faz 0 spike: doğrulanacak 9 madde

spike/ altında minimal bir plugin yaz, bench/mock-llm (OpenAI uyumlu, aldığı her isteği kaydeden yerel sunucu) ile çalıştır. Her madde için sonucu ve seçilen fallback'i docs/phase0-findings.md'ye yaz.

| # | Soru | Nasıl test edilir | Fallback |
|---|---|---|---|
| P0-1 | transform, agent döngüsünün her LLM adımında çağrılıyor mu? Verilen liste DB'nin tamamı mı? | Her çağrıda msgs.length ve son mesaj rolünü logla; 3 tool call'lı görev çalıştır | Çağrılmıyorsa M0'da dur ve raporla; bu sürümde rollover desteklenmez |
| P0-2 | transform'daki değişiklik yalnızca modele mi gidiyor, UI/DB değişmiyor mu? | mock-llm payload'ını kaydet; transform'da ilk mesajı sil; UI ve DB'de durduğunu doğrula | DB'ye yazılıyorsa dur ve raporla (mimari varsayım bozulur) |
| P0-3 | sessionID nereden alınır? | input ve msgs[0].info.sessionID logla | msgs[0].info.sessionID kullan |
| P0-4 | Message/Part nesne şekli; synthetic part için gerekli alanlar; mesaj ID sıralaması | Gerçek mesajı JSON dump et; klonla, text part ekle, payload'da göründüğünü doğrula | Part için id, sessionID, messageID, type: 'text', text; sıralama için ID karşılaştırma yerine liste indeksi kullan |
| P0-5 | assistant tokens semantiği: step başına mı kümülatif mi? Context size formülü | mock-llm bilinen usage döndürsün; message.updated değerleriyle karşılaştır | Formül input + cache.read + cache.write; güvenilmezse chars/4 tahmini |
| P0-6 | Wake-up ve synthetic mesajlar nasıl ayırt edilir? Standart bash arka plan çalıştırıyor mu? | Agent'a `nohup sleep 20 &` çalıştırt; sonuç mesajının rolünü ve flag'lerini gözle | Ayırt edilemiyorsa tüm user mesajları gerçek say (bilinen risk, T6/T7 ile ölçülür) |
| P0-7 | Extraction için child session: create, prompt, tool kapatma, model seçimi, usage okuma, delete | Küçük modelle session.prompt (tool'lar kapalı) çalıştır; text ve info.tokens al | Tool'lar kapatılamıyorsa system prompt'ta tool kullanımını yasakla; silinemiyorsa title `[rollover]` ile bırak ve README'ye yaz |
| P0-8 | subtask: true komutu ucuz çalışıyor mu? rollover_ctl child session'dan parent'ı çözebiliyor mu? command.execute.before var mı? client.tui.showToast çalışıyor mu? | Spike komutu ve tool'u dene | command.execute.before varsa onu kullan; yoksa komut normal model turu olarak çalışır (maliyeti README'de belirt) |
| P0-9 | Ucuz model nasıl çözülür? | config hook girdisinde small_model oku | extractionModel ayarını zorunlu yap; yoksa session modelini kullan ve status'ta uyar |

M0 DoD: Tüm P0 satırları "doğrulandı" veya "fallback seçildi" olarak işaretli, spike/ çalışıyor, bulgular dosyada.

## 3. Repo yapısı ve sınırlar

```
opencode-rollover/
  package.json        # type: module; deps: @opencode-ai/plugin, zod; dev: vitest, typescript, tsx
  src/
    core/             # SAF mantık. Harness importu YASAK (eslint no-restricted-imports)
      types.ts config.ts messages.ts tokens.ts threshold.ts ledger.ts redact.ts
      delta.ts packer.ts render.ts view.ts swapDecision.ts commands.ts
      prompts.ts consolidate.ts metrics.ts ports.ts
    adapter/opencode/
      plugin.ts hooks.ts normalize.ts store.ts llm.ts ctl.ts
  tests/              # core/ adapter/ fixtures/
  bench/              # seed/ prompts/ hidden/ mock-llm/ runner.ts report.ts pricing.json
  docs/               # phase0-findings.md decisions.md
```

src/core/ports.ts çekirdeğin dış dünyayla tek temas yüzeyidir. Başka bir harness'a taşımak = yeni adapter yazmak:

```ts
export type Role = 'user' | 'assistant';

export interface NPart {
  type: 'text' | 'tool' | 'other';
  text?: string;                         // text part
  tool?: string; callId?: string;        // tool part
  status?: 'pending' | 'running' | 'completed' | 'error';
  input?: unknown; output?: string;
  synthetic?: boolean;
}

export interface NMessage { id: string; role: Role; parts: NPart[]; createdAt: number; synthetic?: boolean }

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number }

export interface LlmPort {
  complete(req: { purpose: 'extraction' | 'consolidation'; system: string; user: string;
                  maxOutputTokens: number; timeoutMs: number }):
    Promise<{ text: string; usage: Usage; costUsd?: number; model: string; latencyMs: number }>;
}

export interface StorePort {
  readState(sid: string): Promise<SessionState | null>;
  writeState(sid: string, s: SessionState): Promise<void>;
  appendLedger(sid: string, lines: LedgerLine[]): Promise<void>;
  readLedger(sid: string): Promise<LedgerLine[]>;
  appendMetric(sid: string, ev: MetricEvent): Promise<void>;
}

export interface NotifyPort { toast(msg: string): Promise<void> }
```

normalize.ts OpenCode `{ info, parts }` nesnelerini NMessage'a çevirir. Görünüm uygulaması (§8.4) çekirdekte bir ViewPlan üretir, adapter bunu ham nesneler üzerinde uygular:

```ts
export interface ViewPlan {
  items: Array<{ srcIndex: number; textOnly: boolean }>;   // yeni listenin sırası
  prependText: string;                                      // ilk item'ın başına eklenecek text part
}
```

## 4. Konfigürasyon ve state

### 4.1 Ayarlar

Kaynaklar (sonraki öncekini ezer): `~/.config/opencode/rollover.json`, `.opencode/rollover.json`, ortam değişkeni `ROLLOVER_MODE` (benchmark için). Doğrulama zod ile.

```ts
export interface RolloverConfig {
  mode: 'off' | 'metrics_only' | 'auto';   // varsayılan 'auto'. metrics_only: yalnızca ölçüm, extraction ve swap yok
  thresholdRatio: number;                  // 0.5
  thresholdCapTokens: number;              // 200_000
  thresholdMinTokens: number;              // 20_000
  thresholdTokens: number | null;          // null = hesapla
  tailN: number;                           // 2
  tailMaxN: number;                        // 20
  renderBudgetTokens: number;              // 4_000
  extractionModel: string | null;          // 'provider/model'. null = small_model, o da yoksa session modeli
  extractionDeltaMaxTokens: number;        // 12_000
  extractionTimeoutMs: number;             // 60_000
  consolidateAfterRecords: number;         // 40
  consolidationTimeoutMs: number;          // 90_000
  dataDir: string;                         // '.opencode/rollover'
}
```

Eşik hesabı (core/threshold.ts):

```ts
export function effectiveThreshold(a: { cfg: RolloverConfig; sessionOverride?: number; modelLimit?: number }):
  { value: number; source: 'session' | 'config' | 'computed' | 'fallback' } {
  const lim = a.modelLimit && a.modelLimit > 0 ? a.modelLimit : 0;
  if (a.sessionOverride) return { value: a.sessionOverride, source: 'session' };
  if (a.cfg.thresholdTokens) return { value: a.cfg.thresholdTokens, source: 'config' };
  if (!lim) return { value: 100_000, source: 'fallback' };
  const v = Math.min(Math.floor(lim * a.cfg.thresholdRatio), a.cfg.thresholdCapTokens);
  return { value: Math.max(a.cfg.thresholdMinTokens, v), source: 'computed' };
}
```

Token tahmini tek yerde: `estimateTokens(s) = Math.ceil(s.length / 4)` (core/tokens.ts). Packer, render ve fallback sayaçları bunu kullanır.

### 4.2 Disk düzeni

`<worktree>/.opencode/rollover/<sessionID>/` altında state.json, ledger.jsonl, metrics.jsonl. İlk yazımda `.opencode/rollover/` yoksa `.gitignore`'a eklenir (idempotent). ledger.jsonl ve metrics.jsonl: appendFile, satır başına tek JSON. state.json: tmp dosya + rename. Her session için tek bir in-process promise kuyruğu (mutex) tüm okuma/yazmaları sıralar. Okurken bozuk son satır (yarım yazım) atlanır ve loglanır.

### 4.3 SessionState

```ts
export interface RolloverRecord {          // swap anında dondurulan görünüm bilgisi
  epochAtSwap: number;
  cutoffMessageId: string;                  // yeni görünümün başladığı gerçek user mesajı
  tailMessageIds: string[];                 // sıralı; user ve assistant mesaj id'leri
  renderText: string;                       // dondurulmuş render
  lastReply: string;                        // cutoff öncesi son assistant yanıtı (<= 1500 kar.)
  appliedAt: number; tokensBefore: number; tokensAfter: number;
}

export interface SessionState {
  v: 1; sessionId: string;
  settings: { thresholdTokens?: number; tailN?: number };   // /rollover komutlarıyla yazılır
  epoch: number;                            // 0'dan başlar, her swap'ta +1
  extractedUntilMessageId: string | null;   // extraction cursor
  lastContextTokens: number;
  lastContextSource: 'usage' | 'estimate';
  lastContextAt: number;
  rollover: RolloverRecord | null;          // aktif görünüm; her transform'da yeniden uygulanır
  decidedUserMessageIds: string[];          // son 50
  consolidatedAtRecordCount: number;
  touchedFiles: Record<string, { epoch: number; turn: number }>;
  lastRollover?: { at: number; before: number; after: number; epoch: number };
}
```

### 4.4 Ledger şeması

ledger.jsonl iki tür satır içerir. Hiçbir satır yeniden yazılmaz.

```ts
export type RecordType = 'objective' | 'decision' | 'user_correction' | 'open_item' | 'verification';

export interface LedgerRecord {
  kind: 'record';
  id: string;                  // prefix + oturum boyunca artan sayaç: o1, d2, c3, i4, v5
  type: RecordType;
  text: string;                // <= 300 karakter
  rationale?: string;          // <= 200
  files?: string[];            // <= 5, repo-relative
  status?: 'pass' | 'fail' | 'partial';                              // yalnızca verification
  process?: { command: string; purpose: string; onResult: string };  // yalnızca open_item
  epoch: number; userMessageId: string; turnMessageId: string; createdAt: number;
}

export interface LedgerInvalidation {
  kind: 'invalidate'; id: string;
  reason: 'superseded' | 'resolved' | 'duplicate';
  by?: string;                 // geçersiz kılan kaydın id'si
  at: number;
}

export type LedgerLine = LedgerRecord | LedgerInvalidation;
```

Geçerli kayıt = hakkında invalidate satırı bulunmayan record. `activeRecords(lines)` saf bir fonksiyondur. Id öneki: o, d, c, i, v (sırasıyla objective, decision, user_correction, open_item, verification). Yeni id sayacı, session yüklenirken dosyadaki en büyük sayıdan devam eder.

## 5. Hook haritası

| Olay | Eylem |
|---|---|
| config | /rollover komutunu kaydet (§9), small_model değerini oku |
| chat.params | `modelLimits[sid] = input.model.limit.context`, model id'sini sakla |
| event: message.updated (assistant, tamamlanmış) | Usage'dan context size hesapla (§6), llm_call metriği yaz |
| tool.execute.after (edit, write, patch) | touchedFiles güncelle (§8.7) |
| event: session.idle | Extraction'ı kuyruğa al (§7), ardından konsolidasyon koşulunu kontrol et |
| experimental.chat.messages.transform | Swap kararı ve görünüm uygulaması (§8) |
| tool: rollover_ctl | Komutları çalıştır (§9) |
| event: session.deleted | Bellekteki cache'i temizle (dosyalar kalır) |
| event: session.compacted | Yalnızca logla |

shouldIgnore(sid) true ise hiçbir hook çalışmaz: (a) internalSessions kümesindeki extraction/consolidation child session'ları, (b) parentID olan session'lar (subagent ve komut subtask'ları; sonuç cache'lenir), (c) mode === 'off'. metrics_only modunda yalnızca message.updated ve chat.params işlenir.

## 6. Usage ve context size

- Her tamamlanmış assistant message.updated olayında `ctx = tokens.input + tokens.cache.read + tokens.cache.write` hesapla (P0-5'te doğrula). state.lastContextTokens, lastContextSource='usage' ve lastContextAt güncellenir.
- Hiç usage yoksa (ilk tur veya provider 0 döndürüyorsa) transform içinde tüm mesajların text, tool çıktısı ve JSON(args) uzunluğundan estimateTokens ile tahmin et; lastContextSource='estimate'.
- Rollover kararı yalnızca bu "current context" sayacını kullanır. Kümülatif tüketim state'te tutulmaz; raporlama sırasında metrics.jsonl'den toplanır.

## 7. Extraction (ledger yazımı)

### 7.1 Tetik ve kuyruk
- session.idle (kök session, mode='auto') → scheduleExtraction(sid): 300 ms debounce, session başına tek inflight, çalışırken gelen ikinci tetik kuyruğa bir kez eklenir.
- Çalışmadan önce son assistant mesajının tamamlandığını (time.completed) doğrula; değilse iptal et, sonraki idle'da tekrar denenir.
- extractionInflight: Map<sid, Promise> tutulur; swap'ın "extraction yetişti mi" kontrolü bunu okur.

### 7.2 Delta oluşturma

buildDelta(msgs, cursorId) (core/delta.ts, saf fonksiyon): cursor'dan sonraki mesajlar (cursor null ise hepsi), son tamamlanmış assistant mesajına kadar.

| Kaynak | Delta'ya girişi |
|---|---|
| user text | Aynen; 6000 karakteri aşarsa ortadan kırp (`[...]`) |
| assistant text | Aynen; 3000 karakteri aşarsa ortadan kırp |
| bash | `bash: <komut ≤200 kar.> → exit <kod veya ?> | <çıktının son 15 satırı, ≤600 kar.>`. Komut nohup, sonda & veya --background içeriyorsa `bash [BACKGROUND]:` |
| read, glob, grep, list | Yalnızca `read: <path>`. İçerik asla girmez |
| edit, write, patch | `edit: <path>` |
| Diğer tool'lar | `<tool>: <args ilk 150 kar.> → <status>; hata varsa ilk 200 karakteri` |
| reasoning part'ları | Atılır |

Toplam extractionDeltaMaxTokens'ı aşarsa: user mesajlarına dokunulmaz; tool satırlarının baştan %30'u ve sondan %70'i tutulur, aradaki kısım `[... N tool lines omitted]` ile değiştirilir. Çıktı formatı:

```
[USER m_123]
<metin>
[ASSISTANT m_124]
<metin>
[TOOLS m_124]
- bash: pytest -q → exit 1 | 2 failed, 40 passed
- edit: app/services/pricing.py
```

### 7.3 Model çağrısı (adapter/opencode/llm.ts)
1. Model = cfg.extractionModel ?? small_model ?? session modeli.
2. client.session.create ile child session aç (title `[rollover] extraction`). Session id'yi prompt'tan önce internalSessions'a ekle; böylece hook'lar bu session'ı görmezden gelir ve özyineleme olmaz.
3. client.session.prompt: system = EXTRACTION_SYSTEM (§10.1), tüm tool'lar kapalı, tek text part = delta metni, model yukarıdaki.
4. Çıktı = assistant text part'larının birleşimi; usage = info.tokens, maliyet = info.cost.
5. finally: client.session.delete ve internalSessions.delete.
6. extractionTimeoutMs aşılırsa client.session.abort, sonuç hata sayılır.

### 7.4 Sonuç işleme
1. Kod çitini soy, JSON parse et, zod ile doğrula (`{ records: Record[] }`). Geçersizse bir kez daha çağır (kullanıcı mesajının sonuna `Return ONLY valid JSON matching the schema.` ekle). Yine geçersizse extraction_failed metriği yaz; cursor ilerlemez (delta bir sonraki turun delta'sına dahil olur, boyut sınırı geçerli).
2. redact() uygula (aşağıdaki liste) — text, rationale, process.* alanlarına.
3. Sınırlar: text 300, rationale 200, files 5 yol, tur başına en fazla 12 kayıt (fazlası atılır).
4. Dedupe: aynı type ve normalize edilmiş text (küçük harf, boşluk ve noktalama sil) son 30 geçerli kayıtta varsa atla.
5. Id ata, epoch = state.epoch, userMessageId = delta'daki son user mesajı, turnMessageId = son assistant mesajı, createdAt = Date.now().
6. Mutex altında appendLedger → state.extractedUntilMessageId = turnMessageId → writeState.
7. extraction metriği yaz.

```ts
export const REDACTIONS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{20,}/g, '[redacted]'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/g, '[redacted]'],
  [/AKIA[0-9A-Z]{16}/g, '[redacted]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted]'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  [/(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)\S+/gi, '$1$2[redacted]'],
  [/:][/][/][^/\s:@]+:[^@\s]+@/g, '://[redacted]@'],
];
```

### 7.5 Konsolidasyon (supersedes ve çözülen open_item'lar)
- Koşul: extraction sonrası `geçerliKayıtSayısı - state.consolidatedAtRecordCount >= cfg.consolidateAfterRecords` ve yeni user mesajı gelmemiş olması.
- Girdi: geçerli decision, user_correction, open_item, verification kayıtları, satır başına `id | type | epoch | text`; en yeni 300 kayıt ve ≤ 15k token.
- Çağrı: §7.3 ile aynı mekanizma, CONSOLIDATION_SYSTEM (§10.2), role: 'consolidation'.
- Doğrulama: tüm id ve by değerleri girdi snapshot'ında bulunmalı. user_correction yalnızca by başka bir user_correction ise geçersiz kılınabilir. Doğrulanan her giriş LedgerInvalidation olarak append edilir.
- Snapshot semantiği: çalışırken eklenen kayıtlara dokunulmaz. Başarısızlıkta sonuç yok sayılır ve consolidatedAtRecordCount değişmez.
- Swap bu işi beklemez; bitmemişse mevcut haliyle render edilir.

## 8. Swap ve görünüm (sistemin çekirdeği)

### 8.1 Neden "görünüm"
DB'deki mesajlar silinmez. Transform hook'u her LLM çağrısında DB'nin tam listesini verir. Bu yüzden swap bir kez kararlaştırılır, state.rollover içine dondurulur ve her transform çağrısında yeniden uygulanır. Uygulama, (ham mesaj listesi, state.rollover) girdisinin saf bir fonksiyonudur (idempotent).

### 8.2 Akış (adapter/opencode/hooks.ts)

```ts
async function onTransform(output: { messages: RawMsg[] }) {
  const raw = output.messages;
  if (!raw.length) return;
  const sid = raw[0].info.sessionID;
  if (await shouldIgnore(sid)) return;
  const cfg = await getConfig(sid);
  if (cfg.mode !== 'auto') return;
  const t0 = performance.now();
  try {
    const st = await getState(sid);
    const msgs = raw.map(normalize);

    const d = decideSwap({
      msgs, st, cfg, modelLimit: modelLimits.get(sid),
      extractionCaughtUp: isCaughtUp(st, msgs),
      toolsOpen: hasOpenTools(msgs),
    });

    if (d.action === 'swap') {
      const rec = freezeRollover({ msgs, st, cfg, lines: await readLedger(sid) });
      st.rollover = rec;
      st.epoch += 1;
      st.lastRollover = { at: Date.now(), before: rec.tokensBefore, after: rec.tokensAfter, epoch: st.epoch };
      st.decidedUserMessageIds = pushCap(st.decidedUserMessageIds, d.userMessageId, 50);
      st.lastContextTokens = rec.tokensAfter;
      st.lastContextSource = 'estimate';
      await writeState(sid, st);                       // ÖNCE kalıcı yaz
      await metric(sid, { ev: 'swap', ts: Date.now(), epoch: st.epoch, tokensBefore: rec.tokensBefore,
                          tokensAfter: rec.tokensAfter, renderTokens: estimateTokens(rec.renderText),
                          tailTokens: tailTokens(rec, msgs), swapMs: performance.now() - t0 });
      void notify.toast(msgs.rolloverToast(rec));      // await etme
    } else if (d.action === 'none' && d.markDecided) {
      st.decidedUserMessageIds = pushCap(st.decidedUserMessageIds, d.userMessageId, 50);
      await writeState(sid, st);
    } else if (d.action === 'defer') {
      await metric(sid, { ev: 'swap_deferred', ts: Date.now(), reason: d.reason });
    }

    if (st.rollover) {
      const plan = buildViewPlan(msgs, st.rollover);
      if (!plan) { st.rollover = null; await writeState(sid, st); await metric(sid, { ev: 'cutoff_missing', ts: Date.now() }); return; }
      applyPlan(output, raw, plan);                    // tek splice, §8.4
    }
  } catch (e) {
    await metric(sid, { ev: 'rollover_error', ts: Date.now(), detail: String(e) });
    // output.messages dokunulmamış kalmalı: applyPlan yeni diziyi hazırlar, en son tek splice yapar
  }
}
```

### 8.3 decideSwap kuralları (saf fonksiyon, core/swapDecision.ts)

Tüm koşullar birlikte sağlanırsa swap:
1. last = msgs[msgs.length - 1] bir gerçek kullanıcı mesajı: role === 'user', synthetic değil, hiçbir part synthetic değil, text `<rollover_context` ile başlamıyor.
2. last.id, st.decidedUserMessageIds içinde değil.
3. Önceki en az bir tamamlanmış tur var (msgs içinde en az bir assistant mesajı).
4. contextTokens >= effectiveThreshold(...); contextTokens = st.lastContextTokens (yoksa estimate).
5. Güvenli nokta: (a) önceki mesajlarda pending veya running tool part'ı yok, (b) st.extractedUntilMessageId === son assistant mesajının id'si ve extraction inflight değil.

Sonuç tablosu:

| Durum | Sonuç |
|---|---|
| Koşul 1, 2 veya 3 başarısız | none (decided'a eklenmez) |
| Koşul 4 başarısız | none, markDecided: true |
| Koşul 5 başarısız | defer (decided'a eklenmez; bir sonraki mesajda tekrar denenir) |
| Hepsi sağlanır | swap |

Detached process uyanışı gerçek kullanıcı mesajı olmadığı için koşul 1'i sağlamaz: swap olmaz ama mevcut görünüm uygulanmaya devam eder.

### 8.4 freezeRollover ve buildViewPlan

freezeRollover (swap anında bir kez):
- cutoffMessageId = last.id
- Tail: cutoff'tan önceki gerçek user mesajlarının son N tanesi (N = st.settings.tailN ?? cfg.tailN, ≤ tailMaxN). Her biri için user mesajı ve o turun (sonraki user mesajına kadar) text part'ı olan son assistant mesajı. tailMessageIds sıralı id listesidir.
- lastReply: cutoff'tan hemen önceki assistant mesajının text part'ları, ilk 1500 karakter.
- renderText = renderLedger(...) (§8.5).
- tokensBefore = st.lastContextTokens; tokensAfter = estimate(renderText) + estimate(tail metinleri) + estimate(cutoff mesajı).

buildViewPlan (her çağrıda):
1. cutoffIdx = msgs.findIndex(m => m.id === rec.cutoffMessageId); yoksa (revert vb.) null döner ve çağıran st.rollover temizler.
2. items = tailMessageIds'ten msgs içinde bulunanlar (orijinal sırayla, textOnly: true; text part'ı olmayan assistant mesajları atılır) ve ardından msgs[cutoffIdx..] (hepsi textOnly: false).
3. prependText = rec.renderText; ilk item'a (her zaman user mesajı) ek text part olarak eklenir.
4. Ardışık iki aynı rol oluşuyorsa null döner ve log yazılır (rollover bu çağrı için atlanır).

applyPlan (adapter): yeni diziyi önce tamamen hazırla; değişen mesajları structuredClone ile klonla (ham nesneleri mutasyona uğratma). textOnly item'larda tool, reasoning, file, snapshot ve patch part'larını çıkar. İlk item'ın başına synthetic text part ekle: `{ id: 'prt_rollover_ctx', sessionID, messageID, type: 'text', text: prependText, synthetic: true }` (şekli P0-4'te doğrula). Sonra tek çağrıyla `output.messages.splice(0, output.messages.length, ...yeni)`.

### 8.5 Render (core/render.ts, deterministik)

Aynı girdi her zaman aynı çıktıyı üretir. Şablon aynen (modele gider; boş bölüm yazılmaz):

```
<rollover_context epoch='{epoch}'>
Earlier conversation history was replaced by this record to save context. Treat it as reliable memory of earlier work in this session. Earlier tool outputs and file contents are no longer visible: re-read a file if you need its exact current contents.

## Standing rules and user corrections (must follow)
- [c3] {text}
## Decisions
- [d5] {text} (why: {rationale})
## Open items
- [i7] {text} | background process: `{command}` (purpose: {purpose}). When its result arrives: {onResult}
## Verification state
- [v9] {status}: {text}
## Recent objectives
- [o2] {text}
## Files changed in this session
- {path}
## Last assistant reply before this message
{lastReply}
</rollover_context>
```

Paketleme (core/packer.ts), bütçe cfg.renderBudgetTokens (sabit şablon metni dahil; session ayarı `--render <N>` config katmanlarını geçer), öncelik sırası:
1. Tüm geçerli user_correction kayıtları
2. decision kayıtları, yeniden eskiye
3. open_item kayıtları, yalnızca epoch >= epochAtSwap - 1 olanlar
4. Son 5 verification
5. Son 5 objective
6. Değişen dosyalar (en fazla 40)
7. lastReply (tail'in son assistant yanıtıyla aynıysa tekrarlanmaz)

Her kategori bütçenin kalanı yettiği kadar eklenir; sığmayan kayıt atlanır (kategori içinde en eski önce). Çıktıda bölüm sırası şablondaki gibi, bölüm içinde id artan sırayladır. Kategori 1 tek başına bütçeyi aşarsa en eski kayıtlar kırpılır ve render_truncated metriği yazılır.

### 8.6 Bildirim
`toast('Rollover uygulandı: 187k → 6k token (ledger 3.9k + tail 2k).')`, variant info. Toast başarısız olursa yalnızca logla. Modele gidecek hiçbir mesaj eklenmez.

### 8.7 Dokunulan dosyalar
tool.execute.after içinde `input.tool ∈ { edit, write, patch, multiedit }` ise path'i args'tan çıkar (araç ve arg adlarını P0'da doğrula), worktree'ye göre relative yap ve `state.touchedFiles[path] = { epoch: st.epoch, turn: ++turnCounter }` yaz. Render'da epoch >= epochAtSwap - 1 olanlar, son dokunuşa göre azalan sırayla, en fazla 40.

### 8.8 Arka plan process'ler
- Rollover process'i beklemez. Extraction `[BACKGROUND]` etiketli satırlardan open_item.process alanını üretir; render bu alanı gösterir. Böylece rollover sonrası gelen sonuç yorumlanabilir.
- Çalışan process'lerin ayrı bir registry'si MVP'de yoktur: açık tool çağrıları mesaj part'larının status alanından türetilir (hasOpenTools).
- P0-6'da uyanış mesajı ayırt edilemiyorsa tüm user mesajları gerçek sayılır; bu bilinen risk benchmark'ta T6/T7 ile ölçülür.

## 9. Komutlar

### 9.1 Kayıt

```ts
// config hook
config.command = { ...(config.command ?? {}), rollover: {
  description: 'Rollover: durum ve ayarlar',
  template: 'Call the rollover_ctl tool exactly once with args set to the text after the command, and reply with its result verbatim. Add nothing else. Arguments: $ARGUMENTS',
  subtask: true,                    // temiz child session'da çalışır: ana context'i okumaz
  model: smallModelOrUndefined,
} };
```

rollover_ctl custom tool'u `args: string` alır. Hedef session = çağıran session'ın parentID'si (yoksa kendisi). parseCommand(args) (core/commands.ts, saf) → executeCommand. P0-8 sonucuna göre command.execute.before yolu tercih edilir.

### 9.2 Gramer

| Girdi | Anlam |
|---|---|
| boş veya status | Durumu göster |
| show | Şu an swap olsaydı modele gidecek render önizlemesi ve tür bazında kayıt sayıları |
| on | Bu session'da rollover'ı aç (auto). Zaten açıksa değişiklik yapmaz |
| off | Bu session'da rollover'ı kapat. Zaten kapalıysa değişiklik yapmaz |
| `<N>` veya `<N>k` veya `<N>m` | Bu session'ın eşiğini ayarla (100k = 100000, 1.5m = 1500000). Session kapalıysa ayrıca açar (enabled: true); açıksa yalnızca eşiği günceller. Kalıcı |
| `-n <int>` | Tail boyutunu ayarla. Eşik komutuyla aynı aktivasyon davranışı: kapalıysa açar. Kalıcı |
| `--render <N>` | Render bütçesini ayarla (renderBudgetTokens; `10k`, `1.5m` veya düz sayı). Eşik komutuyla aynı aktivasyon davranışı: kapalıysa açar. Kalıcı |
| `100k -n 5` | İkisi birlikte; kapalıysa açar, açıksa verilen değerleri günceller |

Doğrulama (hata durumunda hiçbir ayar değişmez): eşik < thresholdMinTokens → `Eşik en az 20k olmalı.`; eşik > model limiti → `Eşik model limitini (1M) aşamaz.`; `-n < 0 veya > tailMaxN` → `n 0 ile 20 arasında olmalı.`; `--render < 1k` → `Render bütçesi en az 1k olmalı.`. Ayarlar state.settings'e yazılır.

### 9.3 status çıktısı (İngilizce, sabit format)

```
Rollover: açık (auto)
Eşik: 200k (model limiti: 1M, kaynak: computed)
Güncel context: 142k (eşiğin %71'i)
Tail: son 5 prompt
Özet modeli: provider/model
Ledger: 83 kayıt, epoch 2, aktif render ≈ 3.8k / 4k
Son rollover: 187k → 6k (14:32)
```

mode='off' → `Rollover: kapalı`; metrics_only → `Rollover: yalnızca ölçüm`. Özet modeli çözülemediyse satırın sonuna `(uyarı: session modeli kullanılıyor)` eklenir.

## 10. Prompt'lar (aynen kullanılacak)

### 10.1 EXTRACTION_SYSTEM

```
You maintain a durable memory ledger for a coding-agent session. You receive the DELTA of one turn: the user's message(s), the assistant's replies and condensed tool activity. Extract only information that will still matter after the full transcript is discarded.

Output ONLY a JSON object, no prose, no code fences:
{"records":[ ... ]}

Record types:
- objective: what the user asked for in this turn and what was finally achieved. One record per user request, text <= 240 chars, include the outcome ("done", "partially done: X remains", "blocked: Y").
- decision: a choice that shapes future work and cannot be recovered from the code diff: library or approach chosen or rejected, constraints, conventions, architecture, trade-offs. Add "rationale" (<= 160 chars) when the transcript states one. NOT routine implementation steps and NOT facts obvious from file contents.
- user_correction: the user corrected the assistant or stated a prohibition, preference or standing rule ("never touch X", "don't use Y", "always Z", "use W instead"). Quote the rule faithfully, in English. ALWAYS record these, even when short. A rule that applies from now on or to the whole project is user_correction, not decision.
- open_item: unfinished work, known bugs or failures, TODOs the assistant deferred, or a background process that was started and has not yet reported a result. For a background process fill "process": {"command":...,"purpose":...,"on_result":"what to do when the result arrives"}.
- verification: a test, build or lint run and its outcome. "status": "pass" | "fail" | "partial"; say what ran (command or suite) and, on failure, the key failing test names. One record per distinct kind of run, latest outcome only.

Hard rules:
1. Never record secrets, tokens, passwords, API keys, private keys or connection strings. Write [redacted] if the point must be made.
2. Never record raw tool output, file contents, stack traces or code blocks. Summarize in one sentence.
3. Do not record failed attempts unless the failure led to a decision; then record the decision with the reason.
4. One fact per record. Do not restate the same fact in several records.
5. If the user changed their mind inside this delta, record only the final position.
6. If the turn has nothing durable (chit-chat, thanks), return {"records":[]}.
7. At most 12 records. Prefer fewer, higher-value records.
8. Write all text in English. Translate quoted user rules into English. Keep file paths, identifiers and commands verbatim.
9. "files": repo-relative paths, only when the record is specifically about them (max 5).

Record schema:
{"type":"objective|decision|user_correction|open_item|verification","text":string,"rationale"?:string,"files"?:string[],"status"?:"pass|fail|partial","process"?:{"command":string,"purpose":string,"on_result":string}}

Example 1
DELTA:
[USER m1] Let's switch from JWT to session cookies, and never touch the legacy folder.
[ASSISTANT m2] Done, I converted auth to cookie-based sessions; added app/auth/session.py, tests pass.
[TOOLS m2]
- edit: app/auth/session.py
- bash: pytest tests/unit -q → exit 0 | 48 passed
OUTPUT:
{"records":[{"type":"user_correction","text":"Never touch the legacy folder (tests/legacy/).","files":["tests/legacy/"]},{"type":"decision","text":"Auth is being converted from JWT to cookie-based sessions.","rationale":"The user did not want JWT.","files":["app/auth/session.py"]},{"type":"objective","text":"Auth converted to cookie-based sessions; unit tests pass."},{"type":"verification","text":"pytest tests/unit: 48 passed.","status":"pass"}]}

Example 2
DELTA:
[USER m7] Start the slow integration tests in the background and write the output to /tmp/integ.log.
[ASSISTANT m8] Started (PID 4211). It will keep running while I update the README.
[TOOLS m8]
- bash [BACKGROUND]: nohup pytest tests/integration -q > /tmp/integ.log 2>&1 & → exit 0 | [1] 4211
OUTPUT:
{"records":[{"type":"open_item","text":"Integration tests are running in the background, output goes to /tmp/integ.log.","process":{"command":"nohup pytest tests/integration -q > /tmp/integ.log 2>&1 &","purpose":"Slow integration suite","on_result":"Read /tmp/integ.log and report pass/fail; do not restart the suite."}},{"type":"objective","text":"Integration suite started in the background; awaiting results."}]}

Example 3
DELTA:
[USER m9] thanks
[ASSISTANT m10] You're welcome.
OUTPUT:
{"records":[]}
```

Kullanıcı mesajı (extraction çağrısında): `DELTA:\n` + §7.2 formatındaki delta.

### 10.2 CONSOLIDATION_SYSTEM

```
You clean a memory ledger. Each line is: id | type | epoch | text. Find records that are no longer valid:
- superseded: a later record states a different position on the same topic (the user changed their mind or the approach changed). "by" = id of the later record.
- resolved: an open_item that a later record shows as done or fixed. "by" = id of the record that shows it.
- duplicate: says the same thing as another record. Keep the clearer or newer one; invalidate the other, "by" = the kept id.

Rules:
1. When in doubt, do NOT invalidate. A wrong invalidation loses information; a missing one only costs a few tokens.
2. Invalidate a user_correction only when a later user_correction explicitly reverses it.
3. Never invalidate by guessing: "by" must be an id that appears in the list.
4. One entry per invalidated record.

Output ONLY JSON, no prose, no code fences:
{"invalidate":[{"id":"d3","reason":"superseded","by":"d12"}]}
If nothing to invalidate: {"invalidate":[]}
```

---

# Part B — Rollover — Complete Implementation Specification for OpenCode Fork

## 0. Document Authority

This document and the accompanying `Rollover: Implementasyon Spec (OpenCode MVP)` form one unified implementation specification.

The accompanying specification defines the core architecture and behavior, including: Rollover behavior contract; OpenCode hooks and integration; Core and adapter architecture; Configuration and persistence; Context usage and token estimation; Extraction and ledger management; Consolidation; Swap decision and model-facing view transformation; Rendering and packing; Background process handling; Commands and prompts.

This document completes the implementation requirements with operational safety, error handling, observability, testing, benchmarking, development environment isolation, and execution phases.

**The coding agent must implement both documents together.**

The coding agent is an implementer, not an architecture designer. MUST and MUST NOT indicate mandatory requirements. SHOULD indicates a strong recommendation. MAY indicates an optional implementation. Do not introduce additional product features outside the MVP.

## 1. Development Environment and Repository Safety

### 1.1 Development target
The development target is an existing locally cloned OpenCode fork. All Rollover development MUST happen inside this fork repository. Do not create a separate OpenCode clone. Before making any changes: identify the fork repository root; inspect the repository architecture and package manager; inspect its existing build and test workflows; inspect the current branch; run `git status`; identify pre-existing modifications and untracked files; record the OpenCode source version and commit SHA. Do not overwrite or revert pre-existing user modifications.

### 1.2 Implementation location
Implement Rollover as an isolated package/module within the fork repository. Preserve the architecture defined in the accompanying specification: `src/core/` (pure, harness-independent), `src/adapter/opencode/`, `tests/`, `bench/`, `docs/`. The exact physical location inside the OpenCode monorepo must follow the existing repository conventions. The logical package structure must remain intact. Do not scatter Rollover logic throughout unrelated OpenCode modules. Do not modify OpenCode core internals merely to make an experimental plugin API work. If an unavoidable upstream modification is required, isolate it, document why, and keep it minimal.

### 1.3 Existing OpenCode installation protection
There is already an independently installed OpenCode environment on this machine. It is used for normal development and daily work. It MUST NOT be modified. Never: replace the globally installed executable; run a global upgrade; change global package installation; install or overwrite plugins in the global installation; change the user's global OpenCode configuration; reuse the existing session database; delete existing sessions; reuse existing production or personal session data; modify the default shell PATH; change global environment configuration. All integration tests MUST use a separate executable built from the local fork.

### 1.4 Isolated runtime architecture
Create a dedicated development runtime: `OpenCode Fork Source → Fork Build → Isolated Runtime → Isolated Test Project`. The existing global installation remains completely separate. The isolated runtime MUST have independent: executable (built from the local fork), configuration (dedicated test config), data (dedicated test data directory), sessions (fresh isolated sessions), plugins (test-only plugin loading), cache (separate where applicable), test projects (temporary directories), mock LLM (local mock server). Do not assume environment variable names or configuration overrides. Inspect the actual OpenCode source code and verify how the current version resolves: config directory, data directory, state directory, cache directory, plugin directories, database location. Use the actual supported mechanisms. If the fork cannot isolate these locations through environment variables, use its supported CLI flags or a dedicated isolated HOME directory. Never fall back silently to the global environment.

### 1.5 Test launcher
Create a reproducible launcher, for example `./scripts/dev-opencode.sh`. Its responsibilities: resolve the fork repository root; locate the fork-built executable; verify that the executable exists; verify its version and build identity; create or reuse isolated directories; set the required isolation configuration; verify resolved configuration and data locations; launch the fork executable; fail immediately if isolation cannot be guaranteed. The launcher MUST NOT execute an ambiguous `opencode` command from PATH. All commands in the integration test harness must invoke the fork-built executable explicitly. Create a separate cleanup script for test artifacts. Cleanup MUST be restricted to directories created by the Rollover test environment; it must never accept or delete arbitrary user paths.

### 1.6 Environment safety verification
Add an automated environment safety check. It must verify: executable path belongs to the fork build; executable is not the global installation; configuration directory is isolated; data directory is isolated; test session database is isolated; plugin loading is isolated. If any condition fails, abort integration tests. Record the paths and executable version in `docs/phase0-findings.md`.

### 1.7 Git safety
Do not: run `git reset --hard`; run destructive `git clean`; force checkout over existing changes; rewrite user commits; automatically commit changes; automatically push changes. At completion, report modified and newly created files separately.

## 2. Phase 0: OpenCode Compatibility Spike

Follow the nine P0 investigations defined in the accompanying specification. The spike is mandatory. It must execute against the isolated fork-built OpenCode runtime, not the global installation. Implement a minimal plugin and local mock LLM server.

Verify: P0-1 (transform hook invocation frequency and message completeness); P0-2 (model-facing transformation versus UI/DB isolation); P0-3 (session ID resolution); P0-4 (raw message and part structures); P0-5 (usage semantics and context-size formula); P0-6 (background process wake-up behavior); P0-7 (child session extraction behavior); P0-8 (command and custom tool behavior); P0-9 (small model resolution).

For each item, record: hypothesis; experiment; actual observation; result (verified or fallback selected); implementation consequence; relevant OpenCode source locations, if applicable. Document results in `docs/phase0-findings.md`.

### Mandatory stop conditions
If P0-1 shows that the transform hook does not execute for the required model requests, stop implementation and report the incompatibility. If P0-2 shows that transformation changes persisted messages or UI-visible history, stop implementation and report the architectural incompatibility. Do not attempt to hide a failed architectural assumption with an alternative implementation. For other P0 failures, use the exact fallbacks defined in the accompanying specification.

## 3. Additional Operational Requirements

### 3.1 Error handling
Rollover must be fail-open. A failure in Rollover must never prevent the user from sending a message or using OpenCode normally. The following failures must not break the normal user flow: configuration parsing; state file reading; ledger file reading; ledger file writing; extraction model errors; extraction timeout; invalid extraction JSON; consolidation errors; toast errors; token estimation errors; transform planning errors; missing cutoff messages; unsupported message structures.

| Failure | Required behavior |
|---|---|
| Invalid config | Log error; use safe defaults |
| Corrupt state | Recover safely; do not overwrite unknown data |
| Corrupt final JSONL line | Skip malformed line and log |
| Extraction failure | Keep cursor unchanged |
| Consolidation failure | Keep existing ledger |
| Toast failure | Log only |
| Swap planning failure | Preserve original messages |
| Missing cutoff | Clear stale rollover state safely |
| Unknown message part | Preserve it unless a text-only projection explicitly removes it |
| Store failure | Skip rollover; preserve original message list |

The transform must be transactional from the perspective of OpenCode. Prepare the entire replacement message array before modifying `output.messages`. Perform exactly one final splice after successful preparation. Never partially mutate the original payload.

### 3.2 Persistence safety
Follow the persistence model in the accompanying specification. Additionally: create parent directories before writes; use atomic state writes; handle interrupted writes; avoid concurrent writes for the same session; keep ledger records append-only; never rewrite historical ledger entries; do not delete ledger data during consolidation; validate session IDs before using them in filesystem paths; prevent path traversal; use restrictive file permissions where supported; never store secrets or raw credentials. State version is `v: 1`. Do not silently interpret unsupported future state versions as v1. Log incompatible versions and skip rollover safely.

### 3.3 Concurrency and race conditions
Session operations must be serialized using the per-session promise queue described in the original specification. At minimum, serialize: state reads and writes; ledger append operations; extraction cursor advancement; swap state persistence; epoch updates; settings updates. Extraction and consolidation may run asynchronously, but they must use immutable snapshots of their input. A consolidation result MUST NOT invalidate records created after its snapshot. A stale extraction result MUST NOT overwrite a newer cursor. If the current session state has advanced beyond the state snapshot used by an asynchronous operation, validate the relevant cursor and epoch before committing. Do not use a single global lock for all sessions.

### 3.4 Idempotency
The following operations must be idempotent: applying an existing rollover view; reading the ledger; computing active records; building a ViewPlan; applying a ViewPlan to an equivalent message list; replaying a persisted rollover after process restart. Repeated transform calls must not: duplicate the synthetic rollover part; increment the epoch again; generate another toast; recalculate the frozen render; change the cutoff message; reorder the tail. A swap decision must be persisted before its view is applied.

## 4. Additional Metrics and Observability

Implement `src/core/metrics.ts` and the adapter-side metrics integration. Metrics must be append-only JSONL events. All events must include: `ev`, `ts`, `sessionId`, `epoch` where applicable.

| Event | Purpose |
|---|---|
| `llm_call` | Main or extraction-related usage measurement |
| `extraction_started` | Extraction began |
| `extraction_completed` | Extraction succeeded |
| `extraction_failed` | Extraction failed |
| `consolidation_started` | Consolidation began |
| `consolidation_completed` | Consolidation succeeded |
| `consolidation_failed` | Consolidation failed |
| `swap` | Rollover successfully persisted |
| `swap_deferred` | Swap postponed |
| `cutoff_missing` | Persisted cutoff no longer exists |
| `render_truncated` | Render budget caused record truncation |
| `rollover_error` | Unexpected rollover failure |

### 4.1 Usage metrics
Record, when available: model identifier; purpose; input tokens; output tokens; cache read tokens; cache write tokens; reasoning tokens; cost; latency. Do not assume provider cost data is always available. Missing cost must remain null or absent, not be fabricated.

### 4.2 Swap metrics
Record: context before swap; context after swap; render token estimate; tail token estimate; swap processing duration; epoch; context source.

### 4.3 Metrics correctness
Current context size and cumulative token consumption are separate concepts. Current context size is the value used by rollover decisions. Cumulative consumption is calculated from historical metrics for reporting. Never use cumulative input consumption as the rollover threshold counter. Metrics failure must not break the user flow. Metrics must not include: raw user prompts; raw assistant responses; file contents; tool output; API keys; credentials; private data.

## 5. Additional Test Specification

All core logic must be tested independently from OpenCode. Adapter tests must use realistic OpenCode fixtures. Integration tests must use the fork-built isolated runtime. The local mock LLM must record received requests so that the test suite can verify the exact model-facing payload.

### 5.1 Core unit tests

Configuration: default configuration; global and project precedence; environment variable override; invalid values; null values; threshold overrides; minimum and maximum boundaries.

Threshold: 50% context limit; 200k token cap; 20k minimum; session override; explicit config override; missing model limit fallback; zero and invalid limits.

Token estimation: empty strings; unicode; Turkish characters; long strings; JSON serialization; tool input and output; consistent use of the same estimator.

Ledger: record ID generation; all five record types; invalidations; active record calculation; append-only behavior; duplicate detection; corrupt final JSONL line; invalid record handling; record count and consolidation boundaries.

Extraction delta: null cursor; existing cursor; user messages; assistant messages; incomplete assistant turns; tool calls; background bash commands; reasoning removal; per-message truncation; total delta budget truncation; tool output compaction.

Packing and rendering: category priority; budget enforcement; oldest-record truncation; stable ordering; empty categories; maximum file count; last assistant reply; tail duplication avoidance; exact template structure; deterministic output.

Swap decision: test every condition independently and in combination: real user message; synthetic user message; assistant message; synthetic part; rollover context message; already decided message; no previous assistant message; below threshold; threshold reached; open tool; extraction not caught up; extraction in flight; safe boundary; background wake-up.

View planning: cutoff found; cutoff missing; tail reconstruction; text-only projections; tool and reasoning removal; original message order; consecutive identical roles; synthetic context insertion; repeated transform invocation; original message immutability.

### 5.2 Adapter tests
Use fixtures captured from the actual fork version. Test: hook registration; hook invocation; session ID extraction; message normalization; raw part normalization; synthetic part serialization; store operations; child session lifecycle; timeout and abort; toast handling; command registration; parent session resolution; background process identification; touched file extraction; session deletion cleanup. Do not build all fixtures from manually invented object structures. Capture representative payloads during Phase 0 and use them as regression fixtures.

### 5.3 Integration test scenarios (mandatory)

T1 — Basic rollover: start a session; complete several turns; exceed the configured context threshold; send another real user message; verify the old history is replaced in the model-facing payload; verify the UI and database history remain unchanged; verify the toast is displayed.

T2 — No premature rollover: keep context below threshold; send multiple messages; verify no rollover occurs.

T3 — Open tool protection: start a tool call; keep its result pending; send or simulate a transform event; verify rollover is deferred; complete the tool result; verify the next safe real user message can trigger rollover.

T4 — Extraction failure: force the extraction model to return invalid JSON; force the retry to fail; verify the extraction cursor does not advance; verify the original conversation remains intact; verify normal user interaction continues.

T5 — Restart and persistence: trigger a rollover; restart the isolated OpenCode runtime; reopen the same session; verify persisted state and ledger; verify the same frozen rollover view is applied; verify no duplicate synthetic part or duplicate swap is created.

T6 — Background process wake-up: ask the agent to start a background process; ensure the process remains active while the foreground task completes; trigger a rollover after the threshold is exceeded; allow the background process to finish; observe how OpenCode delivers its completion; verify the wake-up does not cause an unintended rollover when it is identifiable as synthetic; verify the existing rollover view remains applied; verify the background result can be interpreted using the ledger's open item. If the OpenCode version cannot distinguish synthetic wake-ups, apply the P0-6 fallback and record the behavior.

T7 — Background process with extraction race: start a background process; trigger extraction while the process is still running; complete the foreground task; trigger a rollover opportunity; deliver the background result; verify extraction does not prematurely close the open item; verify the next extraction can capture the result; verify no duplicate or premature rollover occurs.

T8 — Consolidation race: start consolidation; append new ledger records while consolidation is running; complete consolidation; verify only snapshot records are invalidated; verify newly appended records remain active.

T9 — Multi-session isolation: start two independent sessions; exceed the threshold in only one; verify the other session is unaffected; verify each session has independent state, ledger, metrics and mutex.

T10 — Failure-open: simulate disk write failure; corrupt state; toast failure; missing model; transform exception; missing cutoff; malformed message part. Verify the original user flow remains operational.

T11 — Manual command behavior: verify all command forms: status; show; threshold values; -n; combined threshold and tail settings. Verify invalid commands do not partially update settings.

T12 — Context accuracy: use the mock LLM to return known usage values. Verify: context size formula; cache read and write inclusion; current context counter; fallback estimation; threshold decision; cumulative metrics calculation.

## 6. Test Performance Requirements

The swap path must not invoke an LLM. Target latency after the user submits a message: target below 250 ms; hard upper bound 5 seconds. Measure the complete transform path, including: state read; ledger read; swap decision; render construction; view planning; payload transformation; state persistence. The toast must not block the transform path. Extraction and consolidation must never run synchronously inside the critical transform path.

Add performance tests for: small message histories; large message histories; large ledgers; maximum tail size; maximum render budget; repeated transform invocations. Report p50, p95 and maximum observed latency. The 5-second hard upper bound must be treated as a release blocker.

## 7. Benchmark Specification

Build a reproducible benchmark harness. All benchmark execution must use: the isolated fork runtime; the local mock LLM or explicitly configured benchmark provider; a dedicated benchmark project; dedicated benchmark sessions; dedicated benchmark state and metrics directories. Never run benchmark experiments against the user's existing OpenCode sessions.

### 7.1 Benchmark architecture
`bench/`: `seed/` (session histories and initial state), `prompts/` (public benchmark prompts), `hidden/` (expected outcomes and hidden evaluation data), `mock-llm/` (local OpenAI-compatible server), `runner.ts`, `report.ts`, `pricing.json`. The benchmark must be repeatable with the same inputs. Record random seeds where applicable. Do not commit credentials or API keys.

### 7.2 Benchmark scenarios
| Scenario | Description |
|---|---|
| B1 | Short conversation below threshold |
| B2 | Long conversation with successful rollover |
| B3 | Repeated rollover across multiple epochs |
| B4 | Large tool-output-heavy conversation |
| B5 | Large ledger with render budget constraints |
| B6 | Extraction failure and retry |
| B7 | Background process completion |
| B8 | Extraction and consolidation concurrency |
| B9 | Multiple sessions |
| B10 | Runtime restart and state recovery |

### 7.3 Baseline comparison
Baseline: Rollover disabled, normal OpenCode context history. Experimental: Rollover enabled, ledger-based history replacement. Both configurations must execute equivalent tasks and use equivalent model configurations wherever possible. Measure: total input tokens; total output tokens; cache read tokens; cache write tokens; total cost where pricing is available; peak current context; number of LLM calls; extraction overhead; consolidation overhead; swap latency; number of successful rollovers; number of deferred rollovers; number of failed rollovers. Do not confuse cumulative token consumption with current context size.

### 7.4 Context savings
Calculate: `Context Reduction % = (Tokens Before - Tokens After) / Tokens Before × 100`. Report both: immediate context reduction at each swap; cumulative token consumption across the complete task. The benchmark must show whether the reduced context actually translates into lower total model input consumption.

### 7.5 Information retention evaluation
Use hidden evaluation cases containing known durable facts: user objectives; decisions; user corrections; open items; verification outcomes; background process instructions; changed files. Evaluate: whether required facts were extracted; whether facts were represented correctly; whether invalidation removed valid information incorrectly; whether the rendered context preserved required information; whether the agent can correctly answer questions after rollover. Report: precision; recall; F1; critical fact omissions; incorrect invalidations; unresolved open items; false claims about completed work. Critical user corrections and active open items must receive special attention. A benchmark must not report a successful token reduction as a successful rollover if important durable information was lost. LLM-dependent quality metrics should be reported separately from deterministic functional test results.

### 7.6 Benchmark report
Generate `bench/reports/rollover-benchmark.md`. Include: OpenCode version and commit; model identifiers; configuration; hardware and runtime information; test dataset identifiers; baseline results; experimental results; token savings; cost comparison; latency percentiles; information retention metrics; failed scenarios; known limitations. The report must distinguish measured values from estimates. Do not invent pricing or token usage when unavailable.

## 8. Documentation Requirements

README.md must explain: what Rollover does; how it differs from normal compaction; architecture overview; installation; configuration; commands; extraction and ledger behavior; threshold calculation; background process handling; limitations; troubleshooting; how to run tests; how to launch the isolated OpenCode fork runtime; how to run benchmarks.

docs/phase0-findings.md must contain all nine P0 investigation results.

docs/decisions.md: record decisions not explicitly covered by the original specification. Each entry must contain decision, reason, date or implementation phase. Do not duplicate decisions already explicitly defined in the specification.

docs/testing.md: explain unit tests; adapter tests; integration tests; mock LLM; runtime isolation; test launcher; benchmark execution.

docs/known-limitations.md: record experimental OpenCode APIs; version-specific behavior; background wake-up limitations; provider usage inconsistencies; any fallback implementation; any unresolved compatibility issue.

## 9. Implementation Phases

Execute the following phases in order. A phase is complete only after its Definition of Done is satisfied. Do not skip ahead.

M0 — Repository inspection and compatibility spike: inspect fork and existing build system; verify global installation remains untouched; build isolated runtime; create isolated test directories; implement minimal spike; complete P0-1 through P0-9; document findings. Do not implement core rollover logic before M0 is complete. DoD: all nine P0 investigations documented as verified or fallback-selected; architectural stop conditions satisfied.

M1 — Project scaffolding and core contracts: create the isolated Rollover package; add package configuration; add TypeScript configuration; add lint and test setup; implement core types; implement ports; implement configuration schemas; add harness import restrictions. DoD: core package builds, lint passes, type checking passes, and the core has no OpenCode harness imports.

M2 — Pure core implementation: messages; token estimation; threshold; ledger; redaction; delta generation; packing; rendering; view planning; swap decision; commands; metrics. Write unit tests alongside each module. DoD: core unit tests pass; deterministic functions have regression coverage.

M3 — Persistence and OpenCode adapter: plugin initialization; hook registration; message normalization; store adapter; atomic state persistence; JSONL ledger and metrics; per-session mutex; model and usage tracking; file tracking. DoD: adapter tests pass against actual Phase 0 fixtures.

M4 — Extraction and consolidation: session idle handling; debounced extraction; delta generation; child session creation; tool restrictions; timeout and abort; JSON validation and retry; redaction; deduplication; ledger append; cursor advancement; consolidation. DoD: extraction and consolidation integration tests pass, including race conditions.

M5 — Rollover and view transformation: transform hook; swap decision; frozen rollover state; tail reconstruction; ledger rendering; text-only projection; synthetic context insertion; toast notification; idempotent reapplication; fail-open behavior. DoD: T1–T5 and T8–T10 pass; model-facing payload is correct and UI/DB history remains unchanged.

M6 — Commands and background processes: /rollover; rollover_ctl; status; show; threshold updates; tail updates; background process extraction; open-item rendering; wake-up handling. DoD: T6, T7 and T11 pass; known wake-up limitations documented.

M7 — Benchmark and performance: benchmark runner; mock LLM instrumentation; baseline and experimental execution; context savings calculation; information retention evaluation; cost and latency reporting. DoD: benchmark report generated; performance requirements verified.

M8 — Final integration and release preparation: run all unit tests; run all adapter tests; run all integration tests; run isolated runtime safety checks; run lint; run type checking; run build; run benchmark; review all documentation; review git diff for unintended changes. DoD: all mandatory tests pass, all deliverables exist, and the global OpenCode installation remains untouched.

## 10. Final Acceptance Criteria

1. The original behavior contract is preserved. 2. The core is independent of OpenCode. 3. Phase 0 compatibility is verified. 4. Extraction and consolidation work correctly. 5. The ledger is append-only. 6. Swap decisions are deterministic. 7. Model-facing history is replaced without changing persisted history. 8. Tool pairs are never broken. 9. Background process results remain interpretable. 10. Repeated transform calls are idempotent. 11. Errors never break normal OpenCode usage. 12. Session isolation works. 13. The toast is displayed on every successful rollover. 14. The original harness compaction behavior is untouched. 15. The complete test suite passes. 16. The benchmark report is generated. 17. Documentation is complete. 18. The fork-built executable is used for integration tests. 19. The existing global OpenCode installation is untouched.

## Final report format

At completion, provide: implementation summary (what was implemented and where); phase results (M0–M8, pass/fail); test results (unit, adapter, integration and performance); benchmark results (token reduction, cost comparison, latency and retention); runtime isolation (fork path, fork commit, executable path, isolated config path, isolated data path, test launcher command); git changes (modified files, new files and any pre-existing changes preserved); known limitations (only actual remaining limitations); launch instructions (exact commands to start the isolated development runtime and run tests).

Do not claim a test passed unless it was actually executed. Do not claim the global installation is untouched unless its isolation was verified. Do not automatically commit or push.
