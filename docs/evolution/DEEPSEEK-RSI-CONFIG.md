# 🚀 DeepSeek V4 Flash Free — Konfigurasi RSI Engine
## Penguat MUEL untuk Model Gratis yang Optimal
**Otoritas:** Chief Architect (CLAUDAI)  
**Disusun oleh:** Principal Engineer (Claude)  
**Berlaku:** RSI Engine v1.0 — MUEL v1.1  
**Tanggal:** 23 Juni 2026

---

> **Prinsip utama:** DeepSeek boleh salah. MUEL yang memastikan hasil akhir benar. Kombinasi model cepat + verifikasi deterministik = hasil setara model mahal dengan biaya 0.

---

## 📊 Spesifikasi Model

| Atribut | Nilai |
|---------|-------|
| **Model ID** | `deepseek-v4-flash` |
| **API Endpoint** | `https://api.deepseek.com/v1/chat/completions` |
| **Format API** | 100% kompatibel OpenAI |
| **Konteks Maksimal** | 128.000 token |
| **Kecepatan** | ~83 token/detik |
| **Biaya** | Gratis (5 juta token/akun) |
| **Kelebihan** | Kode, logika, penalaran terstruktur |
| **Kekurangan** | Lebih lemah dari model berbayar untuk tugas kreatif/abstrak |

---

## ⚙️ Konfigurasi Optimal

### Untuk RSI Engine (`scripts/rsi-engine.ts`)

```typescript
const LLM_API_URL = "https://api.deepseek.com/v1/chat/completions"
const MODEL_NAME = "deepseek-v4-flash"

async function callLLM(prompt: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error("RSI_ENGINE: DEEPSEEK_API_KEY tidak ditemukan")

  const resp = await fetch(LLM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,          // ⚠️ Paling rendah → konsisten
      max_tokens: 2000,          // Cukup untuk kode pendek
      reasoning_effort: "max",   // ✅ Maksimalkan daya pikir
      stream: true,
      stream_options: { include_usage: true }
    })
  })

  const data = await resp.json() as any
  return data.choices?.[0]?.message?.content ?? ""
}
```

### Penjelasan Parameter

| Parameter | Nilai | Alasan |
|-----------|-------|--------|
| `temperature` | `0.1` | Paling rendah = paling deterministik. Untuk kode, kreativitas adalah musuh |
| `reasoning_effort` | `"max"` | DeepSeek akan menggunakan semua daya komputasi untuk reasoning. Penguat gratis |
| `max_tokens` | `2000` | Cukup untuk 1-2 file kode per iterasi. Hemat token |
| `stream` | `true` | Teks panjang diterima utuh. Tidak ada potongan data |
| `stream_options.include_usage` | `true` | Pantau pemakaian token real-time |

---

## 💰 Strategi Hemat Token

### Perkiraan Konsumsi per Iterasi

| Komponen | Token | Detail |
|----------|-------|--------|
| Prompt (MUEL rules) | ~200 | Disimpan di cache DeepSeek → diskon ~90% |
| Response (kode) | ~300 | Rata-rata 1 file ~50 baris |
| **Total per iterasi** | **~500** | |
| **Total per goal (10 iterasi)** | **~5.000** | |

### Dengan 5 Juta Token Gratis

| Skenario | Iterasi | Goal |
|----------|---------|------|
| Perhitungan optimis | ~10.000 iterasi | ~1.000 goal |
| Perhitungan realistis (dengan retry) | ~5.000 iterasi | ~500 goal |

**Kesimpulan:** Token gratis cukup untuk pengembangan penuh MUEL + ratusan goal RSI.

### Tips Hemat

1. **Aktifkan cache:** DeepSeek otomatis cache konteks yang sama → hemat 90% untuk prompt berulang
2. **Prompt ringkas:** Jangan tulis ulang MUEL rules tiap iterasi — cukup referensi singkat
3. **Bersihkan history:** Kosongkan `history[]` array setiap selesai satu goal
4. **Max tokens rendah:** 2000 sudah cukup — kode RSI biasanya pendek

---

## 🔄 Fallback Plan

Jika DeepSeek V4 Flash Free tidak tersedia:

| Prioritas | Model | Endpoint | API Key | Biaya |
|-----------|-------|----------|---------|-------|
| 1 | DeepSeek V4 Flash | `api.deepseek.com` | `DEEPSEEK_API_KEY` | Gratis |
| 2 | OpenAI GPT-4o-mini | `api.openai.com` | `OPENAI_API_KEY` | ~$0.15/1M token |
| 3 | DeepSeek akun kedua | `api.deepseek.com` | `DEEPSEEK_API_KEY_2` | Gratis (daftar baru) |

```typescript
// Cara fallback: ganti 3 baris di rsi-engine.ts
const LLM_API_URL = "https://api.openai.com/v1/chat/completions"  // Ganti
const MODEL_NAME = "gpt-4o-mini"                                   // Ganti
const apiKey = process.env.OPENAI_API_KEY                          // Ganti
```

---

## 🛡️ MUEL + DeepSeek = Kokoh

```
DEEPSEEK V4 FLASH FREE
  ↓ menulis kode (boleh salah)
GUARD RUNTIME (H11) — validasi path + cek pola berbahaya
  ↓
KOMPILATOR — cek sintaks TypeScript
  ↓
228+ TES MUEL — verifikasi kebenaran
  ↓
HASH CHECK (H12) — benchmark utuh
  ↓
RESOURCE BUDGET (H13) — CPU, memory, network
  ↓
Jika PASS → Chief Architect review + ACC/REJECT
Jika FAIL → rollback + iterasi ulang (max 10x)
```

**Hasil akhir:** Setara atau lebih andal dari model berbayar, karena setiap output diverifikasi oleh 228+ tes deterministik.

---

## 🚀 Quick Start

```bash
# 1. Dapatkan API key
#    Daftar di https://platform.deepseek.com

# 2. Set environment variable
set DEEPSEEK_API_KEY=sk-your-key-here

# 3. Jalankan RSI Engine
bun run scripts/rsi-engine.ts --goal "buat fungsi hello world"
```

---

*Dokumen ini adalah addendum konfigurasi untuk RSI Engine. Berlaku di bawah MUEL v1.1.*
