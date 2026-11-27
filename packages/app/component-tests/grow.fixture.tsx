import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { Grow } from "../src/session/composer/spring-height"

const [state, setState] = createStore({ when: false, instant: false, closed: 0, mounts: 0 })

const host = document.createElement("div")

/** One `Grow` with a counted child, and the number of times it reported a close. */
export function mountGrow() {
  host.dataset.testid = "grow-fixture"
  document.body.appendChild(host)
  render(() => {
    function Child() {
      setState("mounts", (count) => count + 1)

      return (
        <div data-testid="grow-child" style={{ height: "80px" }}>
          Grown
        </div>
      )
    }

    return (
      <>
        <output data-testid="grow-closed">{state.closed}</output>
        <output data-testid="grow-mounts">{state.mounts}</output>
        <Grow when={state.when} instant={state.instant} fade onClosed={() => setState("closed", (count) => count + 1)}>
          <Child />
        </Grow>
      </>
    )
  }, host)
}

/** Sets `when` and `instant` together, in one batch. */
export const setGrow = (patch: { when?: boolean; instant?: boolean }) => setState(patch)

/** Detaches the fixture the way an inactive session tab detaches its timeline, with every effect still alive. */
export const detach = () => host.remove()

export const attach = () => document.body.appendChild(host)
