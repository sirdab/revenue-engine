import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import { initTheme } from "./hooks/use-theme";
import { initLocale, tStatic } from "./lib/i18n/i18n";
import { initSentry } from "./lib/sentry";
import "./index.css";

initTheme();
initLocale();
initSentry();

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary
    fallback={
      <div style={{ padding: "2rem", textAlign: "center" }}>
        {tStatic("common.refreshPage")}
      </div>
    }
  >
    <App />
  </Sentry.ErrorBoundary>,
);
