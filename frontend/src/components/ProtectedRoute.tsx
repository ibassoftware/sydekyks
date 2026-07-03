import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Role } from "../lib/api";

export function ProtectedRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gold-400">
        Summoning your Sydekyks…
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
