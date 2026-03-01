
## SSH Bağlantı Bilgileri (2026-03-01)

### Sunucu
- **IP:** 192.168.1.2
- **Hostname:** altintas-server
- **Kullanıcı:** ugur
- **İşletim Sistemi:** Ubuntu 24.04 (6.8.0-101-generic)

### Bağlantı
- SSH şifresi ~/.zsh_history'de mevcuttu (`sshpass` komutlarından)
- sshpass ile şifresiz bağlantı: `sshpass -p 'Mrt1994qq.' ssh -o StrictHostKeyChecking=no ugur@192.168.1.2`

### Sunucu Durumu
- OpenCode web servisi çalışıyor: port 4000
- Servis: `~/.config/systemd/user/opencode-web.service`
- Binary: `~/.opencode/bin/opencode` (v1.2.15)
- PID: 466559 (Feb 27'den beri çalışıyor)
- Erişim: http://192.168.1.2:4000

### Proje Yapısı
- Repo: `~/Projeler/opencode`
- Branch: `feature/plugin-settings-ui` (up to date)
- Bun: v1.3.10 (`~/.bun/bin/bun`)
- node_modules: mevcut

### Yapılan İşlemler
1. SSH bağlantısı kuruldu (192.168.1.2, ugur)
2. `bun install` çalıştırıldı → 2021 paket, değişiklik yok
3. OpenCode web servisi zaten aktif ve çalışıyor
### Server Deployment Learnings (2026-03-01)
- **Remote Server:** 192.168.1.2 (x86_64)
- **Bun Path:** /home/ugur/.bun/bin/bun
- **Build Process:** Used 'bun x turbo build --filter=@opencode-ai/app --filter=opencode' to bypass Storybook build failures.
- **Service Management:** The 'opencode-web.service' uses the binary at '~/.opencode/bin/opencode'.
- **Deployment Gotcha:** Updating the binary while the service is running results in 'Text file busy'. Stopped the service and used 'rm -f' before 'cp' to ensure successful replacement.
- **Service Verification:** Successfully restarted and verified via 'systemctl --user status'.
- **Zombie Process Issue:** Found a detached 'opencode' process (PID 466559) listening on port 4000, which prevented the new service from starting. Manual 'kill -9' was required.

## Plugin Configuration (2026-03-01)
- Successfully added `@opencode-ai/plugin-envsitter` to `~/.opencode/opencode.json` on the LAN server (192.168.1.2).
- The file was missing initially and was created with the plugin entry.
- Restarted `opencode-web.service` via systemd user mode (`systemctl --user restart opencode-web.service`).
- Verified that the service is running and accessible at `http://192.168.1.2:4000`.

## Plugin Configuration Fix (2026-03-01)
- Fixed `ConfigInvalidError` caused by using `plugins` key instead of `plugin` in `opencode.json`.
- Added 4 real plugins from the ecosystem:
  - `@opencode-ai/plugin-envsitter`
  - `opencode-helicone-session`
  - `opencode-notificator`
  - `opencode-wakatime`
- Successfully restarted the service and verified stability.

## Server Update - 2026-03-01
- Successfully pulled latest changes on 192.168.1.2.
- Latest commit: 43c7785c8 (feat(app): add plugins tab to settings dialog)
- Bun path on remote: /home/ugur/.bun/bin/bun
- Workspace build was successful (though storybook failed, it was not the target).
- opencode-web service restarted.

## 2026-03-01: Deployment Fix - Plugins Tab Missing

### Root Cause
The `opencode-web.service` runs `opencode web --port 4000`. The binary's `server.ts` has a catch-all `all("/*")` route that **PROXIES to `https://app.opencode.ai`** (the production CDN), not from a local dist folder. So even if you rebuild the frontend locally, the binary serves whatever is on the production CDN.

The CDN (`index-D7E5miXu.js`) did NOT have `settings.plugins` (Plugins settings tab). The local `packages/app/dist/assets/index-CuJGQ9-a.js` DID have `settings.plugins` (181 occurrences) and `Eklentiler` (3 occurrences).

### Fix Applied
1. Modified `packages/opencode/src/server/server.ts`: Added `OPENCODE_WEB_DIST` env var support. When set, the catch-all serves files from that local directory (with SPA fallback to `index.html`) instead of proxying to CDN.
2. Rebuilt binary on remote (`bun run script/build.ts --single --skip-install`) → new binary at `packages/opencode/dist/opencode-linux-x64/bin/opencode`.
3. Stopped service, replaced `~/.opencode/bin/opencode` with new binary.
4. Added `Environment=OPENCODE_WEB_DIST=/home/ugur/Projeler/opencode/packages/app/dist` to `/home/ugur/.config/systemd/user/opencode-web.service`.
5. Reloaded daemon and started service.

### Verification
```
curl -s -u vaur94:"..." http://localhost:4000/ → index-CuJGQ9-a.js (new local bundle)
curl -s -u vaur94:"..." http://localhost:4000/assets/index-CuJGQ9-a.js | grep -o "settings\.plugins" | wc -l → 181
curl -s -u vaur94:"..." http://localhost:4000/assets/index-CuJGQ9-a.js | grep -o "Eklentiler" | wc -l → 3
```

### Key Lesson
**Binary build does NOT embed the frontend.** It proxies to app.opencode.ai CDN at runtime. To serve custom frontend, must set `OPENCODE_WEB_DIST` env var AND have the `server.ts` code that supports it (rebuilt binary required).
