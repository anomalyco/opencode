// 자식 브릿지를 가장 먼저 포함한다 — 결과물 HTML 에 주입되는 <script src="/__preview-bridge.js"> 와 동일 역할.
// import 즉시 boot() 되어 부모(앱)와 penpal 연결을 시도한다.
import "@opencode-ai/preview-bridge/bridge"

import { render } from "solid-js/web"
import { Router, Route } from "@solidjs/router"
import { App, About } from "./app"

render(
  () => (
    <Router>
      <Route path="/" component={App} />
      <Route path="/about" component={About} />
    </Router>
  ),
  document.getElementById("root")!,
)
