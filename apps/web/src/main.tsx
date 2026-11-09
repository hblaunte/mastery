import React from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, readTheme } from "@mastery/ui/glass";
import "@mastery/ui/tokens.css";
import "@mastery/ui/glass.css";
import "./app.css";
import App from "./App";

// Set the theme before the first paint so a pinned Light or Dark never flashes the other one.
applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
