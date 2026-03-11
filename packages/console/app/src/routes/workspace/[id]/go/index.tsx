import { LiteSection } from "./lite-section"

export default function () {
  return (
    <div data-page="workspace-[id]">
      <div data-slot="sections">
        <LiteSection />
      </div>
    </div>
  )
}
