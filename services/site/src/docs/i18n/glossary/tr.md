# Türkçe sözlük (docs V2)

`src/docs/content/tr/` için çeviri kararları. `src/docs/i18n/glossary.md` içindeki ortak kurallar (ürün adları, kısaltmalar, kod, kalın İngilizce arayüz etiketleri) geçerlidir; `agent`/`subagent` dahil Türkçeye özgü seçimler bu dosyada.

## Kayıt (register)

- `src/i18n/tr.ts` ve V1 Türkçe dokümanlarla uyumlu: siz hitabı, sade ve doğrudan anlatım, emir kipi ("Dosyayı açın", "Komutu çalıştırın").
- "lütfen", "yapmanız gerekmektedir", "-mektedir" gibi ağır kalıplar yok; kısa cümleler.
- İngilizce terimden sonra Türkçe eki sözcüğün okunuşuna göre getirin ve düz kesme işareti kullanın: OpenCode'u, Console'a, Go'ya, API'yi, MCP'yi, TUI'da. Sözlüğe yerleşik yazımları koruyun: promptu, promptlar.
- Tırnak içinde arayüz etiketi verilirken İngilizce etiket korunur: **Settings › Billing**.
- Tire yerine Türkçe noktalama; iki nokta üst üste yalnızca liste veya tanım başlatırken.

## Terimler

| İngilizce | Türkçe | Notlar |
| --- | --- | --- |
| agent, subagent | agent, subagent | İngilizce kalır; "alt agent" değil. `mode: subagent` ve agent adları değişmez. |
| primary agent | birincil agent | |
| parent / child session | üst / alt oturum | |
| coding agent | kodlama agent'ı | `agent` birleşik kullanımlarda da İngilizce kalır. OpenCode için “açık kaynaklı kodlama agent'ı” kullanın; bu ifadeye `AI` eklemeyin. |
| Console (ürün) | Console | "OpenCode Console"; URL, yol ve kodda İngilizce |
| workspace | çalışma alanı | |
| team | ekip | Go Teams İngilizce kalır |
| member | üye | |
| owner / admin | sahip / yönetici | Kalın arayüz etiketleri İngilizce kalır |
| provider (model sağlayıcı) | sağlayıcı | provider key → sağlayıcı anahtarı |
| model | model | Model kimlikleri değişmez |
| tool | araç | `tools` yapılandırma anahtarı kod olarak kalır |
| skill | skill | Türkçe ek: skill'i, skill'ler |
| prompt | prompt | system prompt → sistem promptu |
| session | oturum | |
| command | komut | `/command` kod olarak kalır |
| plugin | eklenti | |
| permission | izin | |
| config / configuration | yapılandırma | |
| formatter | biçimlendirici | |
| theme | tema | |
| keybind | tuş ataması | |
| snapshot | anlık görüntü | |
| compaction | sıkıştırma | |
| checkpoint | kontrol noktası | |
| effort (reasoning) | akıl yürütme düzeyi | `effort` yapılandırma anahtarı değişmez. |
| loopback | loopback | Örneğin loopback adresi veya loopback portu. |
| composer | giriş alanı | |
| transcript | konuşma dökümü | |
| scrollback | kaydırma geçmişi | |
| harness | harness | İngilizce kalır |
| inference | inference | "Inference API" API adı olarak korunur. Tamlamaları Türkçe kurun: Console'un inference hizmeti. |
| endpoint | endpoint | |
| base URL | base URL | |
| API key | API anahtarı | |
| rate limit | hız limiti | İstek kotası kastediliyorsa "istek limiti" |
| usage | kullanım | |
| request | istek | |
| token | token | |
| credit / balance | kredi / bakiye | |
| invoice | fatura | |
| subscription | abonelik | |
| budget | bütçe | |
| billing | faturalandırma | |
| web search | web araması | |
| Free (fiyat etiketi) | Free | Ücretsiz anlamında "ücretsiz" |
| Diff (görüntüleyici) | Diff | Genel fark için "fark" |
| directory / path / file | dizin / yol / dosya | |
| worktree | worktree | Düz metinde İngilizce kalır: worktree'ler, worktree'nin. Kod ve tanımlayıcılar aynen korunur. |
| install / run | kurmak / çalıştırmak | |
| build (geliştirme bölümü) | geliştirme | "build" fiili bağlama göre "derlemek" veya "oluşturmak" |

## Kaçınılanlar

- "agent" yerine "ajan" kullanmayın.
- "workspace" için "çalışma uzayı" değil, "çalışma alanı".
- "plugin" için "eklenti" dışında bir karşılık kullanılmaz.
- İngilizce başlıkları Türkçeleştirirken cümle ortasında büyük harf kullanılmaz (Türkçe başlık düzeni).
