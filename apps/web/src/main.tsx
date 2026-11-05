import React from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./App.js";
import { applyTheme, getInitialTheme } from "./theme.js";
import { demoSnapshotSource } from "./snapshotSource.js";
import { localApiSnapshotSource } from "./apiSnapshotSource.js";

const initialTheme = getInitialTheme();
applyTheme(initialTheme);

const source =
  new URLSearchParams(window.location.search).get("demo") === "1"
    ? demoSnapshotSource
    : localApiSnapshotSource;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App snapshotSource={source} />
  </React.StrictMode>,
);
