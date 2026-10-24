import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { queryClient } from "./query-client";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
