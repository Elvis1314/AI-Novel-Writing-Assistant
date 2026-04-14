import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResponse, SSEFrame } from "@ai-novel/shared/types/api";
import type { ChapterRuntimePackage } from "@ai-novel/shared/types/chapterRuntime";
import { API_BASE_URL } from "@/lib/constants";

interface UseSSEOptions {
  headers?: Record<string, string>;
  onReasoning?: (content: string) => void;
  onDone?: (fullContent: string) => void | Promise<void>;
  onRunStatus?: (payload: { runId: string; status: string; phase?: "streaming" | "finalizing" | "completed"; message?: string }) => void;
}

export function useSSE(options?: UseSSEOptions) {
  const [content, setContent] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<Extract<SSEFrame, {
    type: "tool_call" | "tool_result" | "approval_required" | "approval_resolved";
  }>>>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Array<Extract<SSEFrame, { type: "approval_required" }>>>([]);
  const [latestRun, setLatestRun] = useState<Extract<SSEFrame, { type: "run_status" }> | null>(null);
  const [runtimePackage, setRuntimePackage] = useState<ChapterRuntimePackage | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsStreaming(false);
  }, []);

  const handleFrame = useCallback(
    (frame: SSEFrame) => {
      if (frame.type === "ping") {
        return;
      }

      if (frame.type === "chunk") {
        setContent((prev) => prev + frame.content);
        return;
      }

      if (frame.type === "reasoning") {
        setReasoning((prev) => prev + frame.content);
        options?.onReasoning?.(frame.content);
        return;
      }

      if (frame.type === "done") {
        setIsStreaming(false);
        setIsDone(true);
        void options?.onDone?.(frame.fullContent);
        return;
      }

      if (frame.type === "tool_call" || frame.type === "tool_result" || frame.type === "approval_required" || frame.type === "approval_resolved") {
        setEvents((prev) => [...prev, frame]);
        if (frame.type === "approval_required") {
          setPendingApprovals((prev) => {
            const exists = prev.some((item) => item.approvalId === frame.approvalId);
            return exists ? prev : [...prev, frame];
          });
        }
        if (frame.type === "approval_resolved") {
          setPendingApprovals((prev) => prev.filter((item) => item.approvalId !== frame.approvalId));
        }
        return;
      }

      if (frame.type === "run_status") {
        setLatestRun(frame);
        options?.onRunStatus?.(frame);
        return;
      }

      if (frame.type === "runtime_package") {
        setRuntimePackage(frame.package);
        return;
      }

      if (frame.type === "error") {
        setIsStreaming(false);
        setIsDone(false);
        setError(frame.error);
      }
    },
    [options],
  );

  const start = useCallback(
    async (url: string, body: unknown) => {
      abort();
      setContent("");
      setReasoning("");
      setError(null);
      setIsDone(false);
      setEvents([]);
      setPendingApprovals([]);
      setLatestRun(null);
      setRuntimePackage(null);
      setIsStreaming(true);

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const token = localStorage.getItem("auth_token");
        const isRelativeUrl = !url.startsWith("http");
        const requestUrl = isRelativeUrl ? `${API_BASE_URL}${url}` : url;

        const response = await fetch(requestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options?.headers ?? {}),
          },
          body: JSON.stringify(body ?? {}),
          signal: controller.signal,
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
              const json = (await response.json()) as ApiResponse<unknown>;
              setError(json.error ?? "未登录或登录已过期，请重新登录。");
            } catch {
              setError("未登录或登录已过期，请重新登录。");
            }
          } else {
            setError("未登录或登录已过期，请重新登录。");
          }
          setIsStreaming(false);
          return;
        }

        if (!response.ok || !response.body) {
          // 尝试从 SSE error 帧中提取错误信息，否则使用 HTTP 状态文本
          let errorMessage = `请求失败，状态码 ${response.status}`;
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("text/event-stream")) {
            // 读取一小段 SSE 内容，看看是否有 error 帧
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let leftover = "";
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                leftover += decoder.decode(value, { stream: false });
                const lines = leftover.split("\n");
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.startsWith("data:")) {
                    const raw = trimmed.slice(5).trim();
                    if (raw) {
                      try {
                        const frame = JSON.parse(raw) as SSEFrame;
                        if (frame.type === "error") {
                          errorMessage = frame.error;
                          break;
                        }
                      } catch {
                        // ignore parse errors
                      }
                    }
                  }
                }
                if (errorMessage !== `请求失败，状态码 ${response.status}`) break;
              }
            } finally {
              reader.cancel();
            }
          }
          setError(errorMessage);
          setIsStreaming(false);
          return;
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
            const frame = JSON.parse(rawData) as SSEFrame;
            handleFrame(frame);
          }
        }
      } catch (streamError) {
        if ((streamError as Error).name !== "AbortError") {
          setError(streamError instanceof Error ? streamError.message : "流式请求失败。");
          setIsStreaming(false);
        }
      } finally {
        controllerRef.current = null;
      }
    },
    [abort, handleFrame, options?.headers],
  );

  useEffect(() => abort, [abort]);

  return {
    start,
    abort,
    content,
    reasoning,
    isStreaming,
    isDone,
    error,
    events,
    pendingApprovals,
    latestRun,
    runtimePackage,
  };
}
