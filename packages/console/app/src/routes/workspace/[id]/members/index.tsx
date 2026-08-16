import { MemberSection } from "./member-section"

export default function () {
  return (
    <div data-page="workspace-[id]">
      <div data-slot="sections">
        <MemberSection />
      </div>
    </div>
  )
}
