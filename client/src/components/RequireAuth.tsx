import { Navigate, Outlet } from "react-router-dom";

/**
 * Route guard: checks if auth_token exists in localStorage.
 * If AUTH_PASSWORD is not configured on the server, all API calls
 * succeed without a token, so this guard is harmless in that case.
 */
export default function RequireAuth() {
  const token = localStorage.getItem("auth_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
