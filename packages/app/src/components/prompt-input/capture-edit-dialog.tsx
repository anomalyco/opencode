import { Component, For, Show, createSignal, onCleanup, onMount } from "solid-js"
import Konva from "konva"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { EXPORT_MAX_EDGE, blobToPngFile, loadImage, stageToBlob } from "./capture-export"

export type CaptureEditDialogProps = {
  file: File
  onAdd: (edited: File) => void | Promise<void>
}

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#111827", "#ffffff"] as const
const WIDTHS = [2, 4, 8, 16] as const
// 이미지 둘레 여백. 가장자리에 붙은 크롭 핸들 네모점이 잘리지 않도록 스테이지를 이만큼 키운다.
const PAD = 16

export const CaptureEditDialog: Component<CaptureEditDialogProps> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()

  const [tool, setTool] = createSignal<"pen" | "eraser">("pen")
  const [color, setColor] = createSignal<string>(COLORS[0])
  const [width, setWidth] = createSignal<number>(WIDTHS[1])
  const [cropping, setCropping] = createSignal(false)
  const [strokeCount, setStrokeCount] = createSignal(0)
  const [adding, setAdding] = createSignal(false)
  const [zoom, setZoom] = createSignal(1) // 1 = fit. native 대비 배율은 zoom*scale.
  const [zoomPct, setZoomPct] = createSignal(100) // 원본 대비 표시 배율(%) = round(zoom*scale*100)

  let containerRef!: HTMLDivElement
  let stage: Konva.Stage | undefined
  let drawLayer: Konva.Layer | undefined
  let cropLayer: Konva.Layer | undefined
  let cropRect: Konva.Rect | undefined
  let transformer: Konva.Transformer | undefined
  const dim: Konva.Rect[] = [] // 크롭 바깥을 가리는 반투명 검정 4분할(top/bottom/left/right)
  // 적용된 크롭 영역(display 좌표). null 이면 전체. 크롭 모드를 꺼도 유지돼 추가 시 그대로 잘린다.
  let cropBox: { x: number; y: number; width: number; height: number } | null = null
  const strokes: Konva.Line[] = []
  let scale = 1
  let objectUrl: string | undefined
  // 스테이지 안에서 이미지가 차지하는 영역(패딩 offset 포함). 크롭/디밍/내보내기는 이 영역 기준.
  let imgBounds = { x: PAD, y: PAD, width: 0, height: 0 }
  let baseW = 0 // fit(zoom=1) 시 스테이지 크기(= disp + 2*PAD)
  let baseH = 0
  let zoomMax = 4

  onMount(async () => {
    // ui Dialog 의 size 프리셋(고정 px width/height/max-height)을 덮는다.
    // 세로는 90vh 고정(이미지 스케일 기준). 가로는 우선 90vw 로 펼쳐 가용 영역을 측정한 뒤,
    // 아래에서 콘텐츠(이미지/툴바) 폭에 맞게 줄인다(최대 90vw 캡 유지).
    // 바깥 오버레이 flex(align/justify center)가 컨테이너를 화면 정중앙에 둔다.
    const dialogContainer = containerRef?.closest<HTMLElement>('[data-slot="dialog-container"]')
    if (dialogContainer) {
      dialogContainer.style.width = "90vw"
      dialogContainer.style.height = "90vh"
    }

    objectUrl = URL.createObjectURL(props.file)
    let img: HTMLImageElement
    try {
      img = await loadImage(objectUrl)
    } catch {
      return
    }
    if (!containerRef) return

    const nativeW = img.naturalWidth || img.width
    const nativeH = img.naturalHeight || img.height
    // 펼친 모달(90vw×90vh) 안의 실제 가용 영역(스테이지 컨테이너 client 크기)을 측정해 그 안에 맞춘다.
    // 보통 세로(90vh)가 binding 되어 이미지 스케일을 결정하고, 가로는 아래에서 콘텐츠에 맞게 줄인다.
    const availImgW = Math.max(64, containerRef.clientWidth - PAD * 2)
    const availImgH = Math.max(64, containerRef.clientHeight - PAD * 2)
    scale = Math.min(1, availImgW / nativeW, availImgH / nativeH)
    const dispW = Math.max(1, Math.round(nativeW * scale))
    const dispH = Math.max(1, Math.round(nativeH * scale))
    imgBounds = { x: PAD, y: PAD, width: dispW, height: dispH }
    baseW = dispW + PAD * 2
    baseH = dispH + PAD * 2
    zoomMax = Math.max(4, 1 / scale) // 최소 100% 원본 픽셀까지 확대 가능
    setZoomPct(Math.round(scale * 100))

    stage = new Konva.Stage({ container: containerRef, width: baseW, height: baseH })

    // 가로 콘텐츠 핏: 모달 폭을 이미지(baseW)와 툴바 폭 중 큰 쪽 + 좌우 chrome 에 맞춰 줄인다.
    // 90vw 로 펼친 상태에서 측정하므로 줄이기만 하고, min(90vw, …px) 로 두어 캡을 반응형으로 유지.
    if (dialogContainer) {
      // 툴바 intrinsic 폭: 닫기·추가의 ml-auto 때문에 평소 scrollWidth 는 가용폭 전체로 잡힌다.
      // max-content 로 잠깐 바꿔 한 줄 실제 필요 폭만 잰 뒤 되돌린다.
      const toolbarEl = containerRef.parentElement?.querySelector<HTMLElement>('[data-slot="toolbar"]')
      let toolbarW = 0
      if (toolbarEl) {
        const prevWidth = toolbarEl.style.width
        toolbarEl.style.width = "max-content"
        toolbarW = toolbarEl.scrollWidth
        toolbarEl.style.width = prevWidth
      }
      const desiredStageW = Math.max(baseW, toolbarW)
      const chromeW = dialogContainer.clientWidth - containerRef.clientWidth // 좌우 패딩 합
      const targetW = Math.round(desiredStageW + chromeW)
      dialogContainer.style.width = `min(90vw, ${targetW}px)`
    }

    const imageLayer = new Konva.Layer({ listening: false })
    imageLayer.add(new Konva.Image({ image: img, x: PAD, y: PAD, width: dispW, height: dispH }))

    // 드로잉이 이미지 밖(패딩)으로 삐져나가지 않게 이미지 영역으로 클립.
    drawLayer = new Konva.Layer({ clip: { x: PAD, y: PAD, width: dispW, height: dispH } })

    cropLayer = new Konva.Layer()
    for (let i = 0; i < 4; i++) {
      const r = new Konva.Rect({ fill: "#000000", opacity: 0.5, listening: false })
      dim.push(r)
      cropLayer.add(r)
    }
    cropRect = new Konva.Rect({
      x: PAD,
      y: PAD,
      width: dispW,
      height: dispH,
      // 거의 투명한 fill — 보이지는 않지만 본체를 드래그(이동)할 수 있게 hit 영역을 만든다.
      fill: "rgba(0,0,0,0.001)",
      draggable: true,
      name: "crop-rect",
      // 이동이 이미지 영역 밖으로 나가지 않게 제한. pos 는 절대(줌 반영) 좌표라 imgBounds 에 z 를 곱한다.
      dragBoundFunc: (pos) => {
        const z = stage!.scaleX() || 1
        const w = cropRect!.width() * cropRect!.scaleX() * z
        const h = cropRect!.height() * cropRect!.scaleY() * z
        return {
          x: Math.max(imgBounds.x * z, Math.min(pos.x, (imgBounds.x + imgBounds.width) * z - w)),
          y: Math.max(imgBounds.y * z, Math.min(pos.y, (imgBounds.y + imgBounds.height) * z - h)),
        }
      },
    })
    transformer = new Konva.Transformer({
      rotateEnabled: false,
      keepRatio: false,
      ignoreStroke: true,
      borderStroke: "#3b82f6",
      borderStrokeWidth: 2,
      anchorSize: 10,
      boundBoxFunc: (oldBox, newBox) => {
        // 경계 밖이면 전체를 거부하지 말고(거부하면 모서리가 닿는 순간 리사이즈가 얼어붙음)
        // 닿은 변만 이미지 영역 경계로 클램프한다. 반대쪽 변 위치는 유지.
        // newBox 는 절대(줌 반영) 좌표라 imgBounds 에 z 를 곱한다.
        const z = stage!.scaleX() || 1
        const minX = imgBounds.x * z
        const minY = imgBounds.y * z
        const maxX = (imgBounds.x + imgBounds.width) * z
        const maxY = (imgBounds.y + imgBounds.height) * z
        const box = { ...newBox }
        if (box.x < minX) {
          box.width -= minX - box.x
          box.x = minX
        }
        if (box.y < minY) {
          box.height -= minY - box.y
          box.y = minY
        }
        if (box.x + box.width > maxX) box.width = maxX - box.x
        if (box.y + box.height > maxY) box.height = maxY - box.y
        if (box.width < 24 || box.height < 24) return oldBox
        return box
      },
    })
    transformer.nodes([cropRect])
    cropRect.on("dragmove transform", updateDim)
    cropLayer.add(cropRect, transformer)
    cropLayer.visible(false)

    stage.add(imageLayer, drawLayer, cropLayer)
    updateDim()

    let line: Konva.Line | undefined
    stage.on("pointerdown", () => {
      if (cropping()) return
      // getRelativePointerPosition: 스테이지 scale(줌) 반영 → 항상 논리좌표.
      const pos = stage!.getRelativePointerPosition()
      if (!pos) return
      line = new Konva.Line({
        points: [pos.x, pos.y],
        stroke: color(),
        strokeWidth: width(),
        lineCap: "round",
        lineJoin: "round",
        globalCompositeOperation: tool() === "eraser" ? "destination-out" : "source-over",
      })
      strokes.push(line)
      setStrokeCount(strokes.length)
      drawLayer!.add(line)
    })
    stage.on("pointermove", () => {
      if (!line) return
      const pos = stage!.getRelativePointerPosition()
      if (!pos) return
      line.points(line.points().concat([pos.x, pos.y]))
    })
    const finishStroke = () => {
      line = undefined
    }
    stage.on("pointerup", finishStroke)
    stage.on("pointerleave", finishStroke)
  })

  onCleanup(() => {
    transformer?.destroy()
    stage?.destroy()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  })

  const undo = () => {
    const last = strokes.pop()
    if (!last) return
    last.destroy()
    setStrokeCount(strokes.length)
    drawLayer?.batchDraw()
  }

  // 줌: stage.scale 만 바꾸고 크기를 키운다. 컨테이너(고정 fit 크기)보다 커지면 overflow-auto 가 스크롤.
  // 좌표 논리계는 그대로라 크롭/드로잉/내보내기 수학은 영향 없음(드로잉은 relativePointer 사용).
  const applyZoom = (z: number) => {
    const next = Math.max(1, Math.min(zoomMax, z))
    setZoom(next)
    setZoomPct(Math.round(next * scale * 100))
    if (!stage) return
    stage.scale({ x: next, y: next })
    stage.width(baseW * next)
    stage.height(baseH * next)
    stage.batchDraw()
    return next
  }

  const zoomIn = () => applyZoom(zoom() * 1.25)
  const zoomOut = () => applyZoom(zoom() / 1.25)
  const zoomFit = () => applyZoom(1)

  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return // 모디파이어 없으면 컨테이너 기본 스크롤
    e.preventDefault()
    if (!stage || !containerRef) return
    const old = zoom()
    const next = Math.max(1, Math.min(zoomMax, e.deltaY < 0 ? old * 1.1 : old / 1.1))
    if (next === old) return
    const rect = containerRef.getBoundingClientRect()
    // 커서 지점의 논리좌표를 줌 전후로 고정.
    const cx = e.clientX - rect.left + containerRef.scrollLeft
    const cy = e.clientY - rect.top + containerRef.scrollTop
    const logicalX = cx / old
    const logicalY = cy / old
    applyZoom(next)
    containerRef.scrollLeft = logicalX * next - (e.clientX - rect.left)
    containerRef.scrollTop = logicalY * next - (e.clientY - rect.top)
  }

  // 크롭 사각형 기준으로 이미지 영역 안의 바깥 4영역을 반투명 검정으로 덮고, 잘릴 영역(cropBox)을 갱신한다.
  function updateDim() {
    if (!stage || !cropRect || dim.length < 4) return
    const b = cropRect.getClientRect({ relativeTo: stage })
    const ix = imgBounds.x
    const iy = imgBounds.y
    const ir = imgBounds.x + imgBounds.width
    const ib = imgBounds.y + imgBounds.height
    const x = Math.max(ix, b.x)
    const y = Math.max(iy, b.y)
    const w = Math.min(ir - x, b.width)
    const h = Math.min(ib - y, b.height)
    cropBox = { x, y, width: w, height: h }
    const [top, bottom, left, right] = dim
    top.setAttrs({ x: ix, y: iy, width: imgBounds.width, height: y - iy })
    bottom.setAttrs({ x: ix, y: y + h, width: imgBounds.width, height: Math.max(0, ib - (y + h)) })
    left.setAttrs({ x: ix, y, width: x - ix, height: h })
    right.setAttrs({ x: x + w, y, width: Math.max(0, ir - (x + w)), height: h })
    cropLayer?.batchDraw()
  }

  // 크롭이 전체 이미지면(=자른 영역 없음) true.
  const isFullCrop = () =>
    !cropBox ||
    (cropBox.x <= imgBounds.x &&
      cropBox.y <= imgBounds.y &&
      cropBox.width >= imgBounds.width &&
      cropBox.height >= imgBounds.height)

  // 편집 중에는 핸들+디밍을 보이고, 완료 후에도 자른 영역이 있으면 디밍은 계속 보여 어디가 잘릴지 표시한다.
  const refreshCrop = () => {
    if (!cropLayer || !transformer || !cropRect) return
    const editing = cropping()
    cropLayer.visible(editing || !isFullCrop())
    transformer.visible(editing)
    cropRect.draggable(editing)
    cropRect.listening(editing)
    cropLayer.batchDraw()
  }

  const toggleCrop = () => {
    const next = !cropping()
    setCropping(next)
    if (next) {
      transformer?.forceUpdate()
      updateDim()
    }
    refreshCrop()
  }

  const resetCrop = () => {
    if (!cropRect) return
    cropRect.setAttrs({ ...imgBounds, scaleX: 1, scaleY: 1 })
    transformer?.forceUpdate()
    updateDim()
    refreshCrop()
  }

  const onAddClick = async () => {
    if (!stage || adding()) return
    setAdding(true)
    try {
      const box = cropBox ?? { ...imgBounds }

      // 점선/핸들이 캡처되지 않도록 오버레이를 숨기고 export.
      cropLayer?.visible(false)
      cropLayer?.batchDraw()

      const x = Math.max(imgBounds.x, box.x)
      const y = Math.max(imgBounds.y, box.y)
      const w = Math.min(imgBounds.x + imgBounds.width - x, box.width)
      const h = Math.min(imgBounds.y + imgBounds.height - y, box.height)
      if (w < 1 || h < 1) {
        dialog.close()
        return
      }

      const nativeLong = Math.max(w, h) / scale
      const pixelRatio = (1 / scale) * Math.min(1, EXPORT_MAX_EDGE / nativeLong)

      const blob = await stageToBlob(stage, { x, y, width: w, height: h, pixelRatio })
      if (!blob) {
        dialog.close()
        return
      }
      await props.onAdd(blobToPngFile(blob))
      dialog.close()
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog size="x-large" class="![height:100%]">
      <div data-component="capture-edit" class="flex h-full min-h-0 flex-col gap-3 p-4">
        <div data-slot="toolbar" class="flex shrink-0 flex-wrap items-center gap-2">
          {/* 색상 */}
          <div class="flex items-center gap-1" role="group" aria-label={language.t("prompt.capture.toolColor")}>
            <For each={COLORS}>
              {(swatch) => (
                <button
                  type="button"
                  class="size-6 rounded-full border border-border-base transition-transform"
                  classList={{ "ring-2 ring-border-strong-base scale-110": color() === swatch }}
                  style={{ "background-color": swatch }}
                  aria-label={swatch}
                  aria-pressed={color() === swatch}
                  onClick={() => setColor(swatch)}
                />
              )}
            </For>
          </div>
          <span class="h-5 w-px shrink-0 bg-border-weaker-base" />
          {/* 굵기 */}
          <div class="flex items-center gap-1" role="group" aria-label={language.t("prompt.capture.toolWidth")}>
            <For each={WIDTHS}>
              {(value) => (
                <button
                  type="button"
                  class="flex size-7 items-center justify-center rounded-md hover:bg-surface-base-hover"
                  classList={{ "bg-surface-base-active": width() === value }}
                  aria-label={`${value}`}
                  aria-pressed={width() === value}
                  onClick={() => setWidth(value)}
                >
                  <span
                    class="rounded-full bg-icon-strong-base"
                    style={{
                      width: `${Math.max(4, Math.min(value, 18))}px`,
                      height: `${Math.max(4, Math.min(value, 18))}px`,
                    }}
                  />
                </button>
              )}
            </For>
          </div>
          <span class="h-5 w-px shrink-0 bg-border-weaker-base" />
          {/* 펜 / 지우개 */}
          <Tooltip placement="top" value={language.t("prompt.capture.toolPen")}>
            <IconButton
              type="button"
              icon="pencil-line"
              variant="ghost"
              class="size-7.5"
              data-selected={tool() === "pen" ? "true" : undefined}
              classList={{ "bg-surface-base-active": tool() === "pen" }}
              aria-pressed={tool() === "pen"}
              onClick={() => setTool("pen")}
              aria-label={language.t("prompt.capture.toolPen")}
            />
          </Tooltip>
          {/* 지우개 */}
          <Tooltip placement="top" value={language.t("prompt.capture.toolEraser")}>
            <IconButton
              type="button"
              icon="eraser"
              variant="ghost"
              class="size-7.5"
              data-selected={tool() === "eraser" ? "true" : undefined}
              classList={{ "bg-surface-base-active": tool() === "eraser" }}
              aria-pressed={tool() === "eraser"}
              onClick={() => setTool("eraser")}
              aria-label={language.t("prompt.capture.toolEraser")}
            />
          </Tooltip>
          {/* undo 전용 아이콘이 없어 reset 으로 대체 */}
          <Tooltip placement="top" value={language.t("prompt.capture.toolUndo")}>
            <IconButton
              type="button"
              icon="reset"
              variant="ghost"
              class="size-7.5"
              disabled={strokeCount() === 0}
              onClick={undo}
              aria-label={language.t("prompt.capture.toolUndo")}
            />
          </Tooltip>
          <span class="h-5 w-px shrink-0 bg-border-weaker-base" />
          {/* 크롭 */}
          <Button
            type="button"
            variant={cropping() ? "primary" : "ghost"}
            class="h-7.5"
            aria-pressed={cropping()}
            onClick={toggleCrop}
          >
            {cropping() ? language.t("prompt.capture.toolCropDone") : language.t("prompt.capture.toolCrop")}
          </Button>
          <Show when={cropping()}>
            <Button type="button" variant="ghost" class="h-7.5" onClick={resetCrop}>
              {language.t("prompt.capture.toolCropReset")}
            </Button>
          </Show>
          <span class="h-5 w-px shrink-0 bg-border-weaker-base" />
          {/* 줌 */}
          <Tooltip placement="top" value={language.t("prompt.capture.zoomOut")}>
            <IconButton
              type="button"
              icon="dash"
              variant="ghost"
              class="size-7.5"
              disabled={zoom() <= 1}
              onClick={zoomOut}
              aria-label={language.t("prompt.capture.zoomOut")}
            />
          </Tooltip>
          <Tooltip placement="top" value={language.t("prompt.capture.zoomFit")}>
            <button
              type="button"
              class="min-w-12 rounded-md px-1 text-12-regular text-text-base tabular-nums hover:bg-surface-base-hover"
              onClick={zoomFit}
              aria-label={language.t("prompt.capture.zoomFit")}
            >
              {zoomPct()}%
            </button>
          </Tooltip>
          <Tooltip placement="top" value={language.t("prompt.capture.zoomIn")}>
            <IconButton
              type="button"
              icon="plus-small"
              variant="ghost"
              class="size-7.5"
              disabled={zoom() >= zoomMax}
              onClick={zoomIn}
              aria-label={language.t("prompt.capture.zoomIn")}
            />
          </Tooltip>
          {/* 닫기 / 추가 */}
          <div class="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" class="h-7.5" onClick={() => dialog.close()}>
              {language.t("prompt.capture.close")}
            </Button>
            <Button type="button" variant="primary" class="h-7.5" disabled={adding()} onClick={onAddClick}>
              {language.t("prompt.capture.add")}
            </Button>
          </div>
        </div>

        <div
          ref={containerRef}
          data-slot="stage"
          // 고정 모달 안의 가용 영역을 채우고, 캔버스가 작으면 가운데(safe: 줌으로 넘치면 시작점부터
          // 스크롤되게)에 둔다. 줌 인 하면 이 컨테이너 안에서만 스크롤되고 모달 크기는 그대로.
          class="flex min-h-0 w-full flex-1 overflow-auto rounded-md bg-surface-base [align-items:safe_center] [justify-content:safe_center]"
          onWheel={onWheel}
        />
      </div>
    </Dialog>
  )
}
