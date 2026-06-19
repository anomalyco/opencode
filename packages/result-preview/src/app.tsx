import { createSignal } from "solid-js"
import { A } from "@solidjs/router"

// 브릿지 기능을 시험하기 위한 데모 결과물.
// 부모(앱)가 child.navigate/scrollTo/queryDom/setPickMode/capture 를 호출하고,
// 이 페이지는 console/error 이벤트를 발생시켜 onConsole/onError 중계를 확인한다.

const box: Record<string, string> = {
  "font-family": "system-ui, sans-serif",
  "max-width": "720px",
  margin: "0 auto",
  padding: "24px",
  color: "#111827",
  "line-height": "1.6",
}

const btn: Record<string, string> = {
  padding: "8px 14px",
  "margin-right": "8px",
  "margin-bottom": "8px",
  border: "1px solid #d1d5db",
  "border-radius": "8px",
  background: "#f9fafb",
  cursor: "pointer",
}

function Section(props: { title: string; children: any }) {
  return (
    <section style={{ margin: "28px 0", "border-top": "1px solid #e5e7eb", "padding-top": "16px" }}>
      <h2 style={{ "font-size": "18px", "margin-bottom": "8px" }}>{props.title}</h2>
      {props.children}
    </section>
  )
}

export function App() {
  const [count, setCount] = createSignal(0)

  return (
    <main style={box}>
      <h1 id="title" style={{ "font-size": "26px" }}>
        result-preview 데모
      </h1>
      <p>미리보기 브릿지가 연결되면 부모 앱에서 이 페이지를 캡처·조회·제어할 수 있습니다.</p>

      <Section title="콘솔 / 에러 중계 (onConsole / onError)">
        <button id="btn-log" style={btn} onClick={() => console.log("log 메시지", { count: count() })}>
          console.log
        </button>
        <button id="btn-warn" style={btn} onClick={() => console.warn("warn 메시지")}>
          console.warn
        </button>
        <button id="btn-error" style={btn} onClick={() => console.error("error 메시지")}>
          console.error
        </button>
        <button
          id="btn-throw"
          style={btn}
          onClick={() => {
            throw new Error("의도적으로 던진 에러")
          }}
        >
          throw Error
        </button>
        <button id="btn-reject" style={btn} onClick={() => void Promise.reject(new Error("unhandled rejection 테스트"))}>
          reject Promise
        </button>
      </Section>

      <Section title="요소 선택 (setPickMode) / 카운터">
        <p>부모에서 요소 선택 모드를 켜고 아래 요소를 클릭하면 selector 가 전달됩니다.</p>
        <button id="btn-counter" style={btn} onClick={() => setCount((n) => n + 1)}>
          카운트: {count()}
        </button>
        <span id="pick-target" style={{ padding: "6px 10px", background: "#fef3c7", "border-radius": "6px" }}>
          나를 선택해 보세요
        </span>
      </Section>

      <Section title="DOM / 폼 스냅샷 (queryDom)">
        <form id="demo-form" onSubmit={(e) => e.preventDefault()}>
          <div style={{ "margin-bottom": "8px" }}>
            <label>
              이름 <input name="username" placeholder="홍길동" style={{ padding: "6px" }} />
            </label>
          </div>
          <div style={{ "margin-bottom": "8px" }}>
            <label>
              이메일 <input name="email" type="email" placeholder="a@b.com" style={{ padding: "6px" }} />
            </label>
          </div>
          <label>
            메모
            <textarea name="memo" rows={2} style={{ display: "block", width: "100%", padding: "6px" }} />
          </label>
        </form>
      </Section>

      <Section title="네비게이션 (navigate)">
        <p>
          부모에서 <code>navigate("/about")</code> 를 호출하거나 아래 링크로 이동하면 풀 리로드 후 브릿지가 재연결됩니다.
        </p>
        <A href="/about" style={{ ...btn, display: "inline-block", "text-decoration": "none", color: "#111827" }}>
          /about 으로 이동
        </A>
      </Section>

      <Section title="스크롤 (scrollTo)">
        <p>아래로 긴 콘텐츠가 이어집니다. 부모에서 selector=&quot;#bottom-section&quot; 로 스크롤해 보세요.</p>
        <div style={{ height: "1200px", background: "linear-gradient(#ffffff, #eef2ff)" }} />
        <div id="bottom-section" style={{ padding: "16px", background: "#e0e7ff", "border-radius": "8px" }}>
          맨 아래 섹션입니다 (#bottom-section).
        </div>
      </Section>
    </main>
  )
}

export function About() {
  return (
    <main style={box}>
      <h1 id="title" style={{ "font-size": "26px" }}>
        About 페이지
      </h1>
      <p>navigate() 로 풀 리로드 이동한 결과입니다. 브릿지가 다시 연결되었는지 부모에서 확인하세요.</p>
      <A href="/" style={{ ...btn, display: "inline-block", "text-decoration": "none", color: "#111827" }}>
        홈으로
      </A>
    </main>
  )
}
