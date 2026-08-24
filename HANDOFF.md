# Muse-Glimmer on Rocky - Investigation & Fix

## Goal

Investigate why the muse-glimmer model fails to load on rocky's llama-skein API and fix it, comparing with z4 where it runs successfully.

## Root Cause

**GPU OOM** - The model needs ~20GB VRAM but rocky's RX 7900 XTX has only 24GB. The config used `--n-gpu-layers 99` which tries to put ALL 52 layers on GPU. With the model weights (~19GB), KV cache (~1.8GB for 65K context with q8_0), draft model (~1.6GB), and mmproj (~1.4GB), total exceeds 24GB VRAM.

Compare with z4: R9700 has **49GB VRAM**, so the same config fits easily.

## Fix Applied

Changed `--n-gpu-layers 99` to `--n-gpu-layers 40` in the muse-glimmer config on rocky. This puts 40 of 52 layers on GPU and 12 on CPU, saving enough VRAM to fit within 24GB.

**Before:** `--n-gpu-layers 99` (all layers → OOM)
**After:** `--n-gpu-layers 40` (40 GPU + 12 CPU → fits)

Also killed stale llama-server process (PID 582818) that was holding 20GB VRAM but had a stale "failed" state in llama-skein.

## Verification

- Model loads successfully with `-ngl 40` (tested manually and through llama-skein)
- Model responds to chat completions through the proxy: `state: ready`
- Response example: reasoning model produces reasoning_content as expected

## Key Findings

### llama.cpp Flag Changes (August 2026 update)

The llama.cpp libraries on rocky were recently updated (Aug 11). The new version changed some CLI flags:

- `--draft` → `--model-draft` (for draft model path)
- `--flash-attn` → `--flash-attn on` (now requires value)
- `--draft-n`, `--draft-min` → removed, use `--spec-draft-n-max`, `--spec-draft-n-min`

The config.yaml was already updated to use the new flags.

### State Tracking Issue

When llama-skein retries a failed model load, the state tracking can get out of sync:

1. First load attempt crashes (OOM at 13:31)
2. Model marked as "failed"
3. Retry loads successfully (13:39)
4. State remains "failed" — llama-skein won't proxy requests
5. Restarting llama-skein clears stale state, but the old llama-server process wasn't killed, causing a second OOM

The fix was: kill old llama-server → restart llama-skein → update config → reload.

### Rocky Config Location

Rocky's config is NOT in the source-of-truth config repo. Added to `~/dev/docs-skein/config/rocky/config.yaml`.

## Progress

### Done

- [x] Identified GPU OOM as root cause
- [x] Tested reduced GPU layers (`-ngl 40`) — model loads successfully
- [x] Updated config.yaml on rocky
- [x] Killed stale llama-server process
- [x] Restarted llama-skein, model now in "ready" state
- [x] Verified model responds through proxy
- [x] Copied rocky config to source-of-truth repo

### Next Steps

- [ ] Consider if other models on rocky also need `--n-gpu-layers` tuning (currently all use 40, which seems correct)
- [ ] Investigate why the model loaded successfully with 99 layers at 13:39 but OOMs at 13:55 with same config — possibly transient ROCm VRAM fragmentation
- [ ] Add rocky systemd service file to docs repo

## Critical Context

- **Rocky GPU**: RX 7900 XTX, 24GB VRAM (gfx1100)
- **Z4 GPU**: R9700, 49GB VRAM (gfx1201)
- **Rocky llama-server**: `/home/andreas/.local/lib/llama-cpp/llama-server` — version 1 (dd1ea52), Clang 23.0.0
- **Z4 llama-server**: `/opt/llamacpp-rocm-gfx110X/llama-server` — lemonade-sdk tailored build
- **Rocky config**: `/home/andreas/llama-skein/config.yaml`
- **Z4 config**: `/etc/llama-skein/config.yaml`
- **Rocky API**: `http://192.168.1.126:11435`
- **Z4 API**: `http://192.168.1.81:8080`

## Relevant Files

- `~/dev/docs-skein/config/rocky/config.yaml`: Rocky llama-skein config (just added)
- `/home/andreas/llama-skein/config.yaml` (rocky): Live config
- `/home/andreas/.config/systemd/user/llama-skein.service` (rocky): Service file
- `/home/andreas/.local/lib/llama-cpp/` (rocky): llama.cpp libraries
- `~/dev/docs-skein/topology.md`: Host IPs, GPU info
- `~/dev/docs-skein/deploy/llama-skein.md`: Deploy instructions
