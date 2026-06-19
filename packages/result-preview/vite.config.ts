import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

// 로컬 dev 검증용 미리보기 대상.
// - port 4400: 앱(5000)과 분리 → 실제처럼 cross-origin 시나리오를 그대로 검증.
// - cors: vite dev 는 기본 허용. 앱의 previewReady fetch(mode:"cors")가 통과해야 미리보기가 뜬다.
export default defineConfig({
  plugins: [solid()],
  server: {
    port: 4400,
    strictPort: true,
    cors: true,
  },
})
