import { render } from "solid-js/web"
import { SettingsPanel } from "../../components/SettingsPanel"

function OptionsPage() {
  return (
    <div class="options-container">
      <SettingsPanel isModal={false} />
    </div>
  )
}

const root = document.getElementById("root")
if (root) {
  render(() => <OptionsPage />, root)
}
