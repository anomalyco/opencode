import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal } from "solid-js"
import type { PreviewBridge } from "@/pages/session/preview-bridge"

// 미리보기 패널(SessionSidePanel)이 만든 PreviewBridge 를 컴포저(PromptInput) 등 다른 곳에서
// 쓸 수 있게 공유한다. PromptDocBridge 와 동일한 register-callback 패턴.
export const { use: useSessionPreviewBridge, provider: SessionPreviewBridgeProvider } = createSimpleContext({
  name: "SessionPreviewBridge",
  gate: false,
  init: () => {
    const [bridge, setBridge] = createSignal<PreviewBridge | undefined>()
    // 캡처 진행 상태 + 캡처 실행 핸들러는 컴포저(PromptInput, 캡처→편집→첨부 플로우 소유)가 등록하고,
    // 미리보기 헤더(SessionBrowserChrome)의 버튼이 requestCapture()/capturing() 으로 호출·표시한다.
    const [capturing, setCapturing] = createSignal(false)
    let captureHandler: (() => void) | undefined

    return {
      bridge,
      setBridge,
      capturing,
      setCapturing,
      /** PromptInput 이 캡처→편집→첨부 플로우(captureTab)를 등록. */
      setCaptureHandler: (fn: (() => void) | undefined) => {
        captureHandler = fn
      },
      /** 미리보기 헤더 버튼이 호출 — 등록된 캡처 플로우 실행. */
      requestCapture: () => captureHandler?.(),
      /** 미리보기 iframe 안에서 화면을 캡처해 dataURL 반환. 미연결/실패 시 undefined. */
      capture: async (): Promise<string | undefined> => {
        const child = bridge()?.child()
        if (!child) return undefined
        try {
          return await child.capture()
        } catch {
          return undefined
        }
      },
    }
  },
})
