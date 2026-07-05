import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Admin from "./pages/Admin";
import TenantDashboard from "./pages/TenantDashboard";
import Roster from "./pages/Roster";
import Gadgets from "./pages/Gadgets";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={["super_admin"]}>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hq"
            element={
              <ProtectedRoute roles={["commander", "hero"]}>
                <TenantDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hq/roster"
            element={
              <ProtectedRoute roles={["commander", "hero"]}>
                <Roster />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hq/gadgets"
            element={
              <ProtectedRoute roles={["commander", "hero"]}>
                <Gadgets />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hq/settings"
            element={
              <ProtectedRoute roles={["commander"]}>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
