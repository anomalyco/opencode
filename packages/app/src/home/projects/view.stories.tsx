import { useLanguage } from "@/runtime/i18n/language"
import { HomeUtilityNav } from "./view"

export default { title: "App/Home/Utility nav", id: "app-home-utility-nav" }

const Nav = () => {
  const language = useLanguage()

  return <HomeUtilityNav class="flex" language={language} onOpenSettings={() => {}} onOpenHelp={() => {}} />
}

export const HelpMenu = {
  render: () => (
    // The nav sits in a footer strip at the bottom of the home sidebar, so the story pins it there
    // and the menu opens upward as it does in the app.
    <div class="flex h-[520px] w-[320px] flex-col justify-end rounded-[10px] bg-v2-background-bg-base p-3">
      <Nav />
    </div>
  ),
}
