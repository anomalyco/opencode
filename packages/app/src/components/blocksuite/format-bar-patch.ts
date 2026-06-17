import type { AffineFormatBarWidget } from "@blocksuite/blocks"

// 포맷 바(텍스트/블록 선택 시 뜨는 플로팅 툴바)에서 숨길 inline action id.
const HIDE_ACTION_IDS = new Set(["convert-to-linked-doc"])

// 블록 선택 시 포맷 바를 아예 띄우지 않을 flavour. 이미지 블록은 적용 가능한 inline 액션이
// 없어 More(⋮) 버튼 하나만 남은 포맷 바가 중앙에 뜨는데, 이게 불필요해서 막는다.
const HIDE_BLOCK_FLAVOURS = new Set(["affine:image"])

let patched = false

// AffineFormatBarWidget는 connectedCallback에서 toolbarDefaultConfig(this)를 호출해
// addInlineAction(...)로 버튼을 빌드한다. 프로토타입 메서드를 한 번 래핑해
// "Create Linked Doc" 항목만 건너뛰면 모든 인스턴스에 적용된다(체이닝 위해 this 반환).
export function patchFormatBar(widget: typeof AffineFormatBarWidget) {
  if (patched) return
  patched = true
  const add = widget.prototype.addInlineAction
  widget.prototype.addInlineAction = function (config) {
    if (HIDE_ACTION_IDS.has(config.id)) return this
    return add.call(this, config)
  }

  // 이미지 블록을 선택하면 _shouldDisplay()가 true를 반환해 More(⋮)만 남은 포맷 바가 뜬다.
  // 해당 경우에만 표시를 막는다. 텍스트 선택/문단·리스트 블록 선택 포맷 바는 그대로 동작한다.
  const proto = widget.prototype as unknown as {
    _shouldDisplay: () => boolean
    displayType: string
    _selectedBlocks: ReadonlyArray<{ flavour?: string }>
  }
  const shouldDisplay = proto._shouldDisplay
  proto._shouldDisplay = function (this: typeof proto) {
    if (this.displayType === "block" && this._selectedBlocks?.length === 1) {
      const flavour = this._selectedBlocks[0]?.flavour
      if (flavour && HIDE_BLOCK_FLAVOURS.has(flavour)) return false
    }
    return shouldDisplay.call(this)
  }
}
