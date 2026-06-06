import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
