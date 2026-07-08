import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { ActivityProvider } from "./lib/activity";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Admin from "./pages/Admin";
import AdminMissions from "./pages/AdminMissions";
import TenantDashboard from "./pages/TenantDashboard";
import Roster from "./pages/Roster";
import SydekykDetail from "./pages/SydekykDetail";
import Gadgets from "./pages/Gadgets";
import Missions from "./pages/Missions";
import Issues from "./pages/Issues";
import Settings from "./pages/Settings";
import Team from "./pages/Team";
import TeamMemberAccess from "./pages/TeamMemberAccess";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ActivityProvider>
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
            path="/admin/missions"
            element={
              <ProtectedRoute roles={["super_admin"]}>
                <AdminMissions />
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
            path="/hq/roster/:sydekykId"
            element={
              <ProtectedRoute roles={["commander", "hero"]}>
                <SydekykDetail />
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
            path="/hq/missions"
            element={
              <ProtectedRoute roles={["commander", "hero"]}>
                <Missions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hq/issues"
            element={
              <ProtectedRoute roles={["commander", "hero"]}>
                <Issues />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hq/team"
            element={
              <ProtectedRoute roles={["commander"]}>
                <Team />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hq/team/:userId"
            element={
              <ProtectedRoute roles={["commander"]}>
                <TeamMemberAccess />
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
        </ActivityProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
