# DAFTAR TEMUAN KRITIS (Critical Findings)

**Audit Date**: 2026-06-18  
**Scope**: EF-AI Architecture Review — Phase 1–4  
**Classification**: Phase Gate Artifact (Level 3)  
**Status**: FINAL  

---

## 🔴 Critical Findings (CR-001 through CR-008)

### CR-001: Single-Writer Rule Belum Terbukti Secara Arsitektural

**Lokasi**: ADR-013, ADR-017, AC-04, AC-17, model kepemilikan ProposalStore.

**Deskripsi**: Prinsip single-writer menyatakan bahwa hanya satu layanan atau modul yang boleh menulis data tertentu pada satu waktu. Namun dokumentasi EF-AI saat ini hanya menggunakan aturan dan audit manual tanpa mekanisme teknis yang memaksa hal ini.

**Dampak**: Jika aturan ini terabaikan, banyak pihak (agent, modul eksternal) dapat menulis proposal ke ProposalStore. Audit trail menjadi tidak dapat diandalkan, dan model kepemilikan penulisan tunggal bisa rusak, membuka peluang inkonsistensi data dan konflik tulis bersamaan.

**Bukti**: Arsitektur masih mengandalkan boundary dan audit manual (AD-001 masih aktif). Belum ada penegakan teknis.

**Resolusi**: Sprint F-01 — Invariant checker dengan `callerCaps` guard.

**Status**: ❌ **BELUM** — invariant checker sudah diimplementasi (TG-WRITE 6/6 pass) tapi ADR-024/025 masih research.

---

### CR-002: Reconciliation Deterministik vs Kebenaran

**Lokasi**: ADR-017 (Reconciliation), proses seleksi proposal.

**Deskripsi**: Pemenang proposal ditentukan hanya berdasarkan skor confidence dan waktu produksi. Skor confidence antar-model LLM tidak sebanding — studi menunjukkan model RLHF sering overconfident.

**Dampak**: Pada Phase 6 dengan banyak model, model paling overconfident selalu menang tanpa jaminan kualitas. Agent diversity hanya ilusi.

**Bukti**: Tianpan 2026 — Expected Calibration Error (ECE) ~0.377 untuk verbalized confidence.

**Resolusi**: Sprint F — ADR-025 Confidence Calibration Framework (temperature scaling).

**Status**: 🔶 **ADR-025 DRAFT** — research doc selesai, implementasi ditunda ke Phase 6.

---

### CR-003: Konflik Audit Trail vs Retention

**Lokasi**: AD-CP03-03 (ProposalStore sebagai audit trail), kebijakan retensi data.

**Deskripsi**: ProposalStore diamanatkan sebagai audit trail (append-only) tapi ada kebijakan retensi yang menyarankan penghapusan data lama. Konflik ini antagonis — audit membutuhkan immutability, retention membutuhkan deletion.

**Dampak**: Harus memilih antara integritas audit penuh atau penghematan ruang.

**Bukti**: Groundcover — "Audit logs often must be stored years for compliance." Konflik ini nyata pada ProposalStore.

**Resolusi**: Sprint E — Pisahkan Audit Ledger (append-only) dari Operational Store.

**Status**: ❌ **BELUM** — ADR-023 belum dibuat.

---

### CR-004: Risiko Memory Poisoning dan Konsistensi

**Lokasi**: AR-004, ADR-014 (Memory Agents), manajemen memori.

**Deskripsi**: Sistem menyimpan memori jangka panjang tanpa mekanisme validasi atau usia. Memory rentan poisoning — penyerang dapat memanipulasi isi memori untuk merusak perilaku agen.

**Dampak**: Satu memori keliru bisa membelokkan konteks dan proposal. Tidak ada penghapusan otomatis — efek kumulatif.

**Bukti**: Polyu Survey 2026 — "Adversaries can manipulate memory content to corrupt agent behavior." AR-004 sudah TRIGGERED.

**Resolusi**: Sprint C + F — memorySource field, decay, verifikasi periodik.

**Status**: ❌ **BELUM** — AR-004 TRIGGERED, research doc belum ada.

---

### CR-005: Ketiadaan Provenance End-to-End

**Lokasi**: Seluruh alur: Memori → Konteks → Proposal → Rekonsiliasi → Keputusan (Phase 2–4).

**Deskripsi**: Tidak ada dokumentasi lineage penuh — tidak jelas memori mana dan agen mana yang memicu setiap proposal.

**Dampak**: Jika keputusan buruk terjadi, tim tidak bisa menelusuri akar permasalahan. Decision Amnesia.

**Bukti**: Praktik industri menekankan Decision Lineage untuk audit penuh (ElixirData).

**Resolusi**: Sprint F — ADR-024 Decision Provenance Graph.

**Status**: 🔶 **ADR-024 DRAFT** — research doc selesai, implementasi ditunda.

---

### CR-006: Isolasi Agen Rentan False Consensus

**Lokasi**: ADR-016 (Isolasi Eksekusi Agen), desain Phase 4.

**Deskripsi**: Semua agen menerima konteks yang sama. Jika konteks bias, semua agen menghasilkan output serupa. False consensus — konsensus palsu karena basis data identik.

**Dampak**: Multi-agent menjadi ilusi. Risiko kebijakan bias tak terdeteksi.

**Bukti**: LLMWatch (Dec 2025) — "Jika agen AI terus melatih pada output satu sama lain, mereka berisiko menyempitkan kolam pengetahuan."

**Resolusi**: Sprint A — M-09 Epistemic Diversity Index + falseConsensusWarning.

**Status**: ❌ **BELUM** — butuh MetricsService foundation (G5).

---

### CR-007: Potensi Lingkaran Umpan Balik Mandiri

**Lokasi**: Alur Self-Improvement Phase 2–5 (Memori → Konteks → Proposal → Memori).

**Deskripsi**: Phase 5 memungkinkan sistem makan-diri — hasil keputusan yang disimpan sebagai memori kembali jadi input. Tanpa pemisahan sumber data, sistem bisa memupuk keyakinan sendiri.

**Dampak**: Self-reinforcement — kesalahan awal terakumulasi. Mode kegagalan dikenal di sistem pembelajaran mandiri.

**Bukti**: Mem0 menggunakan mekanisme dua langkah untuk deteksi konflik memori.

**Resolusi**: Phase 6 — source separation, self-generated flag.

**Status**: ⏳ **DEFERRED** — AR-005 OBSERVED, implementasi di Phase 6.

---

### CR-008: Tata Kelola Kesalahan Belum Mencegah Ledakan Jenis Error

**Lokasi**: AD-003 (Registry Error), rencana Phase 6 error handling.

**Deskripsi**: Registri error standar sudah ada, tetapi belum ada enforcement otomatis — error baru bisa ditambahkan tanpa dokumentasi.

**Dampak**: Error ad-hoc tanpa dokumentasi menyulitkan debugging dan membanjiri konsumen log.

**Bukti**: Praktik CI/CD menyarankan kebijakan registered-error-only.

**Resolusi**: Sprint F — CI lint enforcement (AD-003).

**Status**: 🔶 **ERROR_REGISTRY UPDATED** — InvariantViolationError terdaftar. CI lint enforcement belum ada.

---

## 📉 Capability Gaps (Belum Dibuat)

| # | Gap | Status | Target |
|---|---|---|---|
| G-01 | **Decision Provenance Graph** — jejak intent→konteks→bukti→keputusan | 🔶 ADR-024 draft | Sprint F |
| G-02 | **Confidence Calibration Layer** — temperature scaling, ensemble | 🔶 ADR-025 draft | Sprint F research |
| G-03 | **Epistemic Diversity Metrics** — ukur disagreement antar agent | ❌ Belum | Sprint A |
| G-04 | **Policy Engine Terpusat** — enforcement terprogram (OPA/Cloudflare WAF) | ❌ Belum | Phase 6 |
| G-05 | **Trust Score Data** — source quality score per memori | ❌ Belum | Sprint F research |
| G-06 | **Memory Lifecycle Management** — decay, archival, verification | ❌ Belum | Sprint C+F |
| G-07 | **Architectural Invariant Verification** — AC-01..AC-18 model checking | ❌ Belum | Phase 6 |
| G-08 | **Byzantine Agent Protection** — konsensus tahan agen manipulatif | ❌ Belum | Phase 6 |
| G-09 | **Semantic Contradiction Engine** — deteksi kontradiksi implisit | ❌ Belum | Phase 6 |
| G-10 | **Observability Dashboard** — trend, drift, anomaly alerts | ❌ Belum | Phase 6 |

---

## ⚠️ Additional Risks (R-NEW-01 through R-NEW-07)

| # | Risk | Detail | Status |
|---|---|---|---|
| R-NEW-01 | **Confidence Drift** — T harus dikalibrasi ulang saat model berubah | ADR-025 mitigation | OBSERVED |
| R-NEW-02 | **Goodhart's Law** — metrik Phase 5 bisa di-game | Desain anti-gaming diperlukan | OBSERVED |
| R-NEW-03 | **Konflik Audit vs Retensi** — AD-CP03-03 risiko besar jangka panjang | ADR-023 mitigation | ACTIVE |
| R-NEW-04 | **False Consensus Risk** — semua agen lihat konteks sama | M-09 mitigation | ACTIVE |
| R-NEW-05 | **Governance Debt Accumulation** — ADR bertambah cepat tanpa deteksi konflik | Perlu pensiun ADR berkala | OBSERVED |
| R-NEW-06 | **Constraint Drift Antar Phase** — AC-01..AC-25 tumpang-tindih | Invariant verifier | OBSERVED |
| R-NEW-07 | **Facade Bottleneck** — Evolution.Service sebagai single point of communication | Desain peer consensus (Phase 6) | OBSERVED |

---

## Status Resolusi per Sprint

| Sprint | CR Covered | Status |
|---|---|---|
| **Sprint A** | CR-006 (M-09 Diversity Index) | ❌ Blokir G5 ACCEPTED |
| **Sprint C** | CR-004 (memory lifecycle) | ❌ Blokir G5 ACCEPTED |
| **Sprint E** | CR-003 (ADR-023 Audit Ledger) | ❌ Blokir G5 ACCEPTED |
| **Sprint F** | CR-001, CR-005, CR-002, CR-008 | 🔶 4/4 implementasi/research selesai |
| **Phase 6** | CR-007, G-04, G-07, G-08, G-09, G-10 | ⏳ Deferred |

---

## Referensi

- PHASE5_SPECIFICATION.md §16 — Sprint F
- ADR-024_DECISION_PROVENANCE.md — Decision Provenance Graph
- ADR-025_CONFIDENCE_CALIBRATION.md — Confidence Calibration
- ERROR_REGISTRY.md — InvariantViolationError
- ARCHITECTURE_DEBT_REGISTRY.md — CR-001, CR-002, CR-005
- ARCHITECTURAL_RISK_WATCHLIST.md — AR-004, AR-005
