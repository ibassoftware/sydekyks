import { Navigate, useLocation } from "react-router-dom";

/** Backward-compatible route for old bookmarks. Attention work now lives inside Missions. */
export default function Issues() {
  const location = useLocation();
  const current = new URLSearchParams(location.search);
  current.set("view", "attention");
  return <Navigate to={`/hq/missions?${current.toString()}`} replace />;
}
