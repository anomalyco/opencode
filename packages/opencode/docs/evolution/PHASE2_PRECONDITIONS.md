# Phase 2 Preconditions — Active Debt Registry

**Source**: Phase 1 Architecture Review (ChatGPT)
**Status**: See `EF-AI_STATE.md` (SSOT) for authoritative phase/gate status
**Purpose**: Ensure Phase 1 debts do not disappear when Phase 2 begins

---

## Active Debts

See `ARCHITECTURE_DEBT_REGISTRY.md` for full debt details (4 entries: AD-001, AD-003, TD-001, KL-001 — AD-002 reclassified to AR-004 under Risk Watchlist).

**Phase 2 constraint**: Implementation must not worsen any active debt.

---

## God Object Prevention Rules

See also `ARCHITECTURAL_RISK_WATCHLIST.md` (AR-001) for risk tracking and promotion criteria.

**Current Risk**: Evolution.Service tumbuh menjadi Business Logic Hub.

Saat ini 5 method: `status`, `getConfig`, `getProjectContext`, `getMemories`, `getDecisions`. Masih manageable. Tetapi trajectory menuju God Service — setiap phase menambah method baru langsung di facade.

**Target Phase**: Berlaku mulai Phase 2

**Success Criteria**:

1. **Facade Registry pattern** — `Evolution.Service` hanya berfungsi sebagai registry/discovery. Setiap domain menyediakan interface sendiri:

   ```typescript
   // BENAR — facade registry
   interface Interface {
     memory: () => EvolutionMemory.Interface
     decisions: () => EvolutionDecisions.Interface
     project: () => EvolutionProject.Interface
     status: () => Effect<Status, EvolutionStorageError>
     // Phase 2: context, retrieval — domain interface sendiri
   }

   // SALAH — god service
   interface Interface {
     status: () => ...
     getConfig: () => ...
     getProjectContext: () => ...
     getMemories: () => ...
     getDecisions: () => ...
     getContext: () => ... // ❌ langsung nambah method
     getRetrieval: () => ... // ❌ langsung nambah method
   }
   ```

2. **Method count limit** — Jika `Evolution.Service.Interface` melebihi 8 method, wajib refactor ke registry pattern sebelum menambah method baru.

3. **Each new domain = new service** — Phase 2 tidak menambah method baru ke `Evolution.Service`. Setiap domain baru (Context, Retrieval, dll) mendapat Service class sendiri dan diregistrasi di `EvolutionBrain`.

---

## How This Document Is Used

1. Sebelum memulai implementasi Phase 2, baca preconditions ini.
2. Pastikan implementasi Phase 2 tidak memperburuk AD-001, AD-003, atau TD-001.
3. Jika ada perubahan signifikan pada arsitektur yang mempengaruhi debt ini, update dokumen dan notifikasi Architecture Reviewer.
4. Dokumen ini tidak harus di-resolve sebelum Phase 2 — tetapi preconditions harus tetap terlihat selama Phase 2 berjalan.
