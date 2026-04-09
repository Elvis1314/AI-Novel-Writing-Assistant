import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await apiClient.post("/auth/login", { password });
      const token = res.data?.data?.token;
      if (token) {
        localStorage.setItem("auth_token", token);
        navigate("/", { replace: true });
      } else {
        setError("登录失败，请重试。");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "登录失败。";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-3xl shadow-lg">
            ✍️
          </div>
          <h1 className="text-2xl font-bold text-white">AI 小说创作助手</h1>
          <p className="mt-2 text-sm text-white/60">请输入访问密码</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="访问密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="border-white/10 bg-white/5 text-white placeholder:text-white/30 focus-visible:ring-violet-500"
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-center text-sm text-red-300">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={!password.trim() || loading}
            className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600"
          >
            {loading ? "登录中..." : "登 录"}
          </Button>
        </form>
      </div>
    </div>
  );
}
