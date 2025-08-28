import { Match, Switch } from "solid-js"
import { useAccount } from "../components/context-account"
import { Navigate } from "@solidjs/router"
import { IconLogo } from "../ui/svg"
import styles from "./lander.module.css"
import { useOpenAuth } from "../components/context-openauth"

export default function Index() {
  const auth = useOpenAuth()
  const account = useAccount()
  return (
    <Switch>
      <Match when={account.current}>
        <Navigate href={`/${account.current!.workspaces[0].id}`} />
      </Match>
      <Match when={!account.current}>
        <div class={styles.lander}>
          <div data-slot="hero">
            <section data-slot="top">
              <div data-slot="logo">
                <IconLogo />
              </div>
              <h1>opencode Gateway Console</h1>
            </section>

            <section data-slot="cta">
              <div>
                <span onClick={() => auth.authorize({ provider: "github" })}>Sign in with GitHub</span>
              </div>
              <div>
                <span onClick={() => auth.authorize({ provider: "google" })}>Sign in with Google</span>
              </div>
            </section>
          </div>
        </div>
      </Match>
    </Switch>
  )
}
