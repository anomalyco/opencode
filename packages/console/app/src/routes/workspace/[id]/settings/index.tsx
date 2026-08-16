import { InvoiceDetailsSection, SettingsSection } from "./settings-section"

export default function () {
  return (
    <div data-page="workspace-[id]">
      <div data-slot="sections">
        <SettingsSection />
        <InvoiceDetailsSection />
      </div>
    </div>
  )
}
