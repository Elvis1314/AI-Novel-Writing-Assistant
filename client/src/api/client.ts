import axios, { AxiosError } from "axios";
import type { ApiResponse } from "@ai-novel/shared/types/api";
import { API_BASE_URL, API_TIMEOUT_MS } from "@/lib/constants";
import { toast } from "@/components/ui/toast";

export interface ApiHttpError extends Error {
  status?: number;
  details?: unknown;
}

declare module "axios" {
  interface AxiosRequestConfig {
    silentErrorStatuses?: number[];
  }
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
});

// Attach auth token to every request
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResponse<unknown>>) => {
    const status = error.response?.status;
    const backendError = error.response?.data?.error;
    const silentErrorStatuses = error.config?.silentErrorStatuses ?? [];
    let message = backendError ?? error.message ?? "请求失败。";

    if (!status) {
      message = "网络连接失败，请检查网络后重试。";
    } else if (status >= 500) {
      message = backendError ?? "服务器错误，请稍后重试。";
    } else if (status === 401) {
      // Clear stale token and redirect to login
      localStorage.removeItem("auth_token");
      // Avoid infinite redirect loops
      if (!window.location.pathname.includes("/login")) {
        window.location.href = "/login";
      }
      const authError = new Error("未登录或登录已过期") as ApiHttpError;
      authError.status = 401;
      return Promise.reject(authError);
    }

    if (!status || !silentErrorStatuses.includes(status)) {
      toast.error(message);
    }

    const normalizedError = new Error(
      message,
    ) as ApiHttpError;
    normalizedError.status = status;
    normalizedError.details = error.response?.data;
    return Promise.reject(normalizedError);
  },
);
