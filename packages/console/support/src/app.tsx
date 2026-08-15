import { Title } from "@solidjs/meta"
import { Loading } from "solid-js"
import { Router } from "./router"
import "./app.css"

export default function App() {
  return (
    <Router>
      {(props) => (
        <>
          <Title>opencode support</Title>
          <Loading>{props.children}</Loading>
        </>
      )}
    </Router>
  )
}
