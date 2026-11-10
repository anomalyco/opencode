import "./tone.css"
import { siteSettings } from "../settings"

/**
 * The grade's inputs for tone.css, from Settings › 404 arcade › Saturation (0–100, percent of the
 * paintings' colour) and White balance (−100 cool to 100 warm).
 */
export const toneInputs = (saturation: number, balance: number) => ({
  "--tone-sat-pct": `${saturation}%`,
  "--tone-warm": `${Math.max(0, balance)}%`,
  "--tone-cool": `${Math.max(0, -balance)}%`,
})

export const arcadeTone = () => toneInputs(siteSettings.arcadeSaturation, siteSettings.arcadeWhiteBalance)

/** The page colour for the browser chrome: tone.css's --tone-backdrop (grey #1d1d1d, colour #161e21). */
export const backdropColor = (saturation: number) =>
  `rgb(${[29, 29, 29].map((grey, index) => Math.round(grey + ([22, 30, 33][index] - grey) * (saturation / 100))).join(" ")})`

/**
 * Runs inline before the scene is parsed, so the saved grade applies from the first paint: the same
 * inputs and browser chrome colour as above, from the saved settings (on the development server;
 * production, which has no Settings, keeps the defaults).
 */
export const toneScript = `(()=>{let s=35,b=0;${import.meta.env.DEV ? `try{const v=JSON.parse(localStorage.getItem("opencode-site-settings-v3")||"null");if(typeof v?.arcadeSaturation==="number")s=Math.min(100,Math.max(0,v.arcadeSaturation));if(typeof v?.arcadeWhiteBalance==="number")b=Math.min(100,Math.max(-100,v.arcadeWhiteBalance))}catch{}` : ""}const r=document.documentElement.style;r.setProperty("--tone-sat-pct",s+"%");r.setProperty("--tone-warm",Math.max(0,b)+"%");r.setProperty("--tone-cool",Math.max(0,-b)+"%");const c="rgb("+[29,29,29].map((g,i)=>Math.round(g+([22,30,33][i]-g)*(s/100))).join(" ")+")";document.querySelectorAll('meta[name="theme-color"]').forEach((m)=>{m.content=c})})()`
