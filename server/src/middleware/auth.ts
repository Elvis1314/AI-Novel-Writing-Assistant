import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const TOKEN_SECRET = process.env.TOKEN_SECRET ?? "ai-novel-default-secret-change-me";
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function createToken(): string {
  const payload = JSON.stringify({ exp: Date.now() + TOKEN_EXPIRY_MS });
  const iv = crypto.randomBytes(16).toString("hex");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ p: payload, i: iv, s: sig })).toString("base64url");
}

function verifyToken(token: string): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf-8"));
    if (!decoded.p || !decoded.s) return false;
    const payload = decoded.p;
    const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
    if (sig !== decoded.s) return false;
    const data = JSON.parse(payload);
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  const query = req.query.token;
  if (typeof query === "string" && query.trim()) {
    return query.trim();
  }
  return undefined;
}

/** Public routes that don't require authentication */
const PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/health",
]);

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // If no password configured, skip auth entirely
  if (!AUTH_PASSWORD) {
    next();
    return;
  }

  // Allow public routes
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  // Verify token
  const token = extractBearerToken(req);
  if (!token || !verifyToken(token)) {
    res.status(401).json({
      success: false,
      error: "未登录或登录已过期，请重新登录。",
    });
    return;
  }

  next();
}

export function loginHandler(req: Request, res: Response): void {
  const { password } = req.body;
  if (!AUTH_PASSWORD) {
    res.status(400).json({ success: false, error: "服务端未配置登录密码。" });
    return;
  }
  if (password !== AUTH_PASSWORD) {
    res.status(401).json({ success: false, error: "密码错误。" });
    return;
  }
  const token = createToken();
  res.json({ success: true, data: { token } });
}
