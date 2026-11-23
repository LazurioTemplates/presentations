import { registerAgentTools } from "@lazurio/module-kit/webmcp";
import React from "react";
import ReactDOM from "react-dom/client";
import "design-system/styles.css";
import App from "./App.tsx";
import { LanguageContext, MESSAGES, resolveLanguage } from "./i18n.ts";
import "./index.css";

void resolveLanguage(window.location.search).then((language) => {
  document.documentElement.lang = language;
  document.title = MESSAGES[language].appName;
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <LanguageContext.Provider value={language}>
        <App />
      </LanguageContext.Provider>
    </React.StrictMode>,
  );
});

// The tools for agents, as the server lists them for the person
// (`src/agent-tools.ts`), registered where the browser offers WebMCP; each
// call goes to the same handler as `/mcp`. The library never changes them
// while it is open, so it registers them once.
void registerAgentTools();
