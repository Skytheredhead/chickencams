import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";
import LiveView from "./views/LiveView.jsx";
import RewindView from "./views/RewindView.jsx";
import ExportView from "./views/ExportView.jsx";
import SettingsView from "./views/SettingsView.jsx";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, refetchOnWindowFocus: false } }
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<LiveView />} />
            <Route path="rewind" element={<RewindView />} />
            <Route path="rewind/:cameraId" element={<RewindView />} />
            <Route path="dvr/:cameraId" element={<RewindView />} />
            <Route path="activity" element={<Navigate to="/rewind" replace />} />
            <Route path="export" element={<ExportView />} />
            <Route path="settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
