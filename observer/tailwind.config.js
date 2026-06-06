/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/client/**/*.{js,ts,jsx,tsx,html}"],
  theme: {
    extend: {
      colors: {
        "oc-bg": "#0a0a0a",
        "oc-surface": "#141414",
        "oc-border": "#262626",
        "oc-text": "#e5e5e5",
        "oc-muted": "#737373",
        "oc-accent": "#3b82f6",
        "oc-green": "#22c55e",
        "oc-red": "#ef4444",
        "oc-yellow": "#eab308",
        "oc-purple": "#a855f7",
      },
    },
  },
  plugins: [],
};
