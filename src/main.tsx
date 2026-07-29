import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { I18nProvider } from "./i18n";
import "./index.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const payload = `${error.toString()}\n${info.componentStack || ""}`;
    console.error("React render error:", payload);
    try {
      invoke("debug_log", { message: payload }).catch(() => {});
    } catch {
      // ignore
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#ff6b6b", whiteSpace: "pre-wrap" }}>
          <h2>Render error</h2>
          <pre>{this.state.error.toString()}</pre>
          <pre>{(this.state.error as Error).stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>
);
