import { KeySection } from "./key-section"

export default function () {
  return (
    <div data-page="workspace-[id]">
      <div data-slot="sections">
        <KeySection />
      </div>
    </div>
  )
}
