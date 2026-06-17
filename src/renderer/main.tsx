import React from "react";
import ReactDOM from "react-dom/client";
import * as ort from "onnxruntime-web";
import "./styles/global.css";
import App from "./App";

// ORT wasm assets are copied to the `ort/` dir next to index.html by
// vite-plugin-static-copy. Resolve to an absolute URL against the document so
// onnxruntime-web fetches them from there — a bare "./ort/" would be resolved
// relative to the ort module itself (node_modules/.../dist/) and 404 in dev.
// document.baseURI works in both dev (http://localhost:PORT/) and the packaged
// app (file://.../out/renderer/index.html).
ort.env.wasm.wasmPaths = new URL("ort/", document.baseURI).href;
ort.env.wasm.numThreads = 1;

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 40,
            color: "#fff",
            background: "#1a1a2e",
            height: "100vh",
            fontFamily: "monospace",
          }}
        >
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, padding: "8px 16px", cursor: "pointer" }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
