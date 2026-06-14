# EF-AI Architectural Principles
# Source of truth — bukan chat session
# Versi ini adalah canonical. Chat session bisa hilang. Dokumen ini tidak boleh.

Last updated: 2026-06-12

---

## P-01 — EF-AI Bukan Router LLM

EF-AI bukan LiteLLM wrapper, bukan OpenRouter clone, bukan multi-model switcher.
Router adalah satu komponen kecil di Phase 6.

Target arsitektur:
  Foundation Brain
       ↓
  Context Intelligence
       ↓
  Decision Engine
       ↓
  Agent Orchestration
       ↓
  Evolution Layer

Setiap keputusan implementasi dinilai berdasarkan:
Apakah ini membantu atau menghambat jalur di atas?

---

## P-02 — Kontrak Lebih Penting Daripada Fitur

EF-AI memilih:
  Interface yang jujur
  Error model yang benar
  Boundary yang jelas

Bukan:
  Fitur baru
  Optimisasi prematur
  Shortcut implementasi

Jika harus memilih antara:
  "Phase terlambat 2 minggu"
  vs
  "Technical debt masuk ke fondasi"

Pilih terlambat.

---

## P-03 — Dependency Direction Tidak Boleh Terbalik

Benar:
  Evolution Layer
       ↓
  OpenCode Core

Salah:
  OpenCode Core
       ↓
  Evolution Layer

Setiap perubahan yang membuat OpenCode mengetahui detail Evolution
dianggap risiko arsitektur sampai terbukti tidak berbahaya.

---

## P-04 — Tiga Gate, Bukan Satu

Phase belum selesai hanya karena kode ada.

  IMPLEMENTED = kode sudah ada dan di-review
  VERIFIED    = test green + tsc clean
  ACCEPTED    = architecture + verification disetujui

Ketiganya wajib.
Phase baru tidak boleh dimulai sebelum ketiganya ✅.
Tanpa pengecualian.

---

## P-05 — Type System Tidak Boleh Berbohong

Jika runtime dapat menghasilkan:
  EvolutionNotEnabledError
  AdrNotFoundError
  EvolutionStorageError

Maka interface harus mencerminkan itu.

Dilarang menyembunyikan error untuk membuat typecheck terlihat bersih.
Silent error = contract violation = upstream routing corruption.

---

## P-06 — Technical Debt Harus Diberi Nama

Jangan tulis: "nanti diperbaiki"

Format wajib:
  TD-xxx atau AD-xxx
  Deskripsi
  Risiko jika tidak diperbaiki
  Target phase

Debt tanpa identitas hilang dari memori proyek.
Debt yang hilang muncul kembali sebagai bug di phase berikutnya.

---

## P-07 — Jangan Oversell Kemampuan EF-AI

Jika retrieval masih keyword search: tulis "keyword search"
Jika belum semantic: tulis "belum semantic"
Jika belum autonomous: tulis "belum autonomous"

Tujuan EF-AI adalah sistem yang benar.
Bukan sistem yang terdengar pintar.

---

## P-08 — Add vs Replace Wajib Diklasifikasikan

Setiap proposal wajib diberi label sebelum implementasi:

ADD:
  Menambah kemampuan baru.
  Tidak mengubah kontrak yang sudah ada.
  Risiko lebih rendah.

REPLACE:
  Mengubah perilaku, kontrak, atau arsitektur yang sudah ada.
  Harus dijelaskan: apa yang dihapus, apa dampaknya, siapa yang terpengaruh.

Tanpa label: proposal ditolak sampai diklasifikasikan.

---

## P-09 — Phase Gate Rule

Tidak boleh memulai phase baru sampai phase sebelumnya:
  IMPLEMENTED ✅
  VERIFIED    ✅
  ACCEPTED    ✅

Tidak ada pengecualian.
"Fitur terlihat menarik" bukan alasan.
"Deadline mendesak" bukan alasan.
Fondasi yang belum stabil selalu lebih mahal diperbaiki di Phase 4-5.

---

## P-10 — Default Reviewer Posture

Saat ragu:
  Kritik dulu.
  Verifikasi dulu.
  Implementasi belakangan.

Biaya memperbaiki fondasi sekarang:
  Murah.

Biaya memperbaiki fondasi di Phase 4-5:
  Mahal — semua layer di atasnya ikut rusak.

---

## Prinsip Satu Kalimat

"Sistem kecil yang benar lebih baik dari sistem besar yang rapuh."
