import type { ApiResponse, CreativeHubStreamFrame } from "@ai-novel/shared/types/api";
import type {
  CreativeHubMessage,
  CreativeHubResourceBinding,
  CreativeHubThread,
  CreativeHubThreadHistoryItem,
  CreativeHubThreadState,
} from "@ai-novel/shared/types/creativeHub";
import { API_BASE_URL } from "@/lib/constants";
import { apiClient } from "./client";

function ensureThreadId(threadId: string): string {
  const normalized = threadId.trim();
  if (!normalized) {
    throw new Error("创作中枢线程不存在，请先创建线程。");
  }
  return normalized;
}

export async function listCreativeHubThreads(): Promise<ApiResponse<CreativeHubThread[]>> {
  const { data } = await apiClient.get<ApiResponse<CreativeHubThread[]>>("/creative-hub/threads");
  return data;
}

export async function createCreativeHubThread(payload?: {
  title?: string;
  resourceBindings?: CreativeHubResourceBinding;
}): Promise<ApiResponse<CreativeHubThread>> {
  const { data } = await apiClient.post<ApiResponse<CreativeHubThread>>("/creative-hub/threads", payload ?? {});
  return data;
}

export async function updateCreativeHubThread(threadId: string, payload: {
  title?: string;
  archived?: boolean;
  resourceBindings?: CreativeHubResourceBinding;
}): Promise<ApiResponse<CreativeHubThread>> {
  const resolvedThreadId = ensureThreadId(threadId);
  const { data } = await apiClient.patch<ApiResponse<CreativeHubThread>>(`/creative-hub/threads/${resolvedThreadId}`, payload);
  return data;
}

export async function deleteCreativeHubThread(threadId: string): Promise<ApiResponse<null>> {
  const resolvedThreadId = ensureThreadId(threadId);
  const { data } = await apiClient.delete<ApiResponse<null>>(`/creative-hub/threads/${resolvedThreadId}`);
  return data;
}

export async function getCreativeHubThreadState(threadId: string): Promise<ApiResponse<CreativeHubThreadState>> {
  const resolvedThreadId = ensureThreadId(threadId);
  const { data } = await apiClient.get<ApiResponse<CreativeHubThreadState>>(`/creative-hub/threads/${resolvedThreadId}/state`);
  return data;
}

export async function getCreativeHubThreadHistory(threadId: string): Promise<ApiResponse<CreativeHubThreadHistoryItem[]>> {
  const resolvedThreadId = ensureThreadId(threadId);
  const { data } = await apiClient.get<ApiResponse<CreativeHubThreadHistoryItem[]>>(`/creative-hub/threads/${resolvedThreadId}/history`);
  return data;
}

export async function generateCreativeHubThreadTitle(threadId: string): Promise<ApiResponse<{ title: string }>> {
  const resolvedThreadId = ensureThreadId(threadId);
  const { data } = await apiClient.post<ApiResponse<{ title: string }>>(`/creative-hub/threads/${resolvedThreadId}/generate-title`);
  return data;
}

export async function resolveCreativeHubInterrupt(
  threadId: string,
  interruptId: string,
  payload: { action: "approve" | "reject"; note?: string },
): Promise<ApiResponse<CreativeHubThreadState>> {
  const resolvedThreadId = ensureThreadId(threadId);
  const { data } = await apiClient.post<ApiResponse<CreativeHubThreadState>>(
    `/creative-hub/threads/${resolvedThreadId}/interrupts/${interruptId}`,
    payload,
  );
  return data;
}

export async function* streamCreativeHubRun(
  threadId: string,
  payload: {
    messages: CreativeHubMessage[];
    checkpointId?: string | null;
    resourceBindings?: CreativeHubResourceBinding;
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  },
  abortSignal?: AbortSignal,
): AsyncGenerator<CreativeHubStreamFrame> {
  const resolvedThreadId = ensureThreadId(threadId);
  const requestBody = {
    messages: payload.messages,
    ...(payload.checkpointId ? { checkpointId: payload.checkpointId } : {}),
    ...(payload.resourceBindings ? { resourceBindings: payload.resourceBindings } : {}),
    ...(payload.provider ? { provider: payload.provider } : {}),
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
    ...(payload.maxTokens !== undefined ? { maxTokens: payload.maxTokens } : {}),
  };
  const token = localStorage.getItem("auth_token");
  const response = await fetch(`${API_BASE_URL}/creative-hub/threads/${resolvedThreadId}/runs/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(requestBody),
    signal: abortSignal,
  });

  // 401: 清 token + 跳转登录页（行为与 axios interceptor 保持一致）
  if (response.status === 401) {
    localStorage.removeItem("auth_token");
    if (!window.location.pathname.includes("/login")) {
      window.location.href = "/login";
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const json = (await response.json()) as { error?: string };
        throw new Error(json.error ?? "未登录或登录已过期，请重新登录。");
      } catch {
        throw new Error("未登录或登录已过期，请重新登录。");
      }
    }
    throw new Error("未登录或登录已过期，请重新登录。");
  }

  if (!response.ok || !response.body) {
    throw new Error(`创作中枢请求失败，状态码 ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const rawFrame of frames) {
      const payloadLine = rawFrame
        .split("\n")
        .find((line) => line.startsWith("data:"));
      if (!payloadLine) {
        continue;
      }
      const rawData = payloadLine.replace("data:", "").trim();
      if (!rawData) {
        continue;
      }
      yield JSON.parse(rawData) as CreativeHubStreamFrame;
    }
  }
}
