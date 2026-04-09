# AI Novel Writing Assistant - Production Dockerfile
# Multi-stage build for monorepo (client + server + shared)

FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /app

# 1. Copy workspace root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 2. Copy each workspace member's package.json
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# 3. Install all dependencies (pnpm resolves all workspaces)
RUN pnpm install --frozen-lockfile

# 4. Copy source code
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY tsconfig.base.json ./

# 5. Build all workspaces in dependency order
RUN pnpm --filter @ai-novel/shared build
RUN pnpm --filter @ai-novel/client build
RUN pnpm --filter @ai-novel/server build

# =============================================
# Runtime stage (production image)
# =============================================
FROM node:20-bookworm-slim AS runtime
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

# Create non-root user for security
RUN groupadd -g 1001 appgroup && useradd -u 1001 -g appgroup -m appuser
WORKDIR /app

# Copy node_modules (production deps only)
COPY --from=base /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=base /app/client/dist ./client/dist
COPY --from=base /app/server/dist ./server/dist
COPY --from=base /app/shared/dist ./shared/dist

# Copy server runtime files
COPY --from=base /app/server/package.json ./server/
COPY --from=base /app/server/prisma ./server/prisma

# Copy workspace root files
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/pnpm-lock.yaml ./
COPY --from=base /app/pnpm-workspace.yaml ./

# Install production dependencies only (no devDependencies)
RUN pnpm install --frozen-lockfile --prod

# Create data directory for SQLite
RUN mkdir -p /app/data /app/logs && chown -R appuser:appgroup /app

# Create startup script using printf (Docker-safe)
RUN printf '#!/bin/sh\n' > /app/start.sh && \
    printf 'set -e\n' >> /app/start.sh && \
    printf 'echo "[1/3] Generating Prisma client..."\n' >> /app/start.sh && \
    printf 'cd /app/server\n' >> /app/start.sh && \
    printf 'npx prisma generate --schema src/prisma/schema.prisma\n' >> /app/start.sh && \
    printf 'echo "[2/3] Pushing database schema..."\n' >> /app/start.sh && \
    printf 'npx prisma db push --schema src/prisma/schema.prisma --skip-generate\n' >> /app/start.sh && \
    printf 'echo "[3/3] Starting server..."\n' >> /app/start.sh && \
    printf 'cd /app\n' >> /app/start.sh && \
    printf 'exec pnpm --filter @ai-novel/server start\n' >> /app/start.sh && \
    chmod +x /app/start.sh

USER appuser
ENV NODE_ENV=production

EXPOSE 3000 5173

CMD ["/app/start.sh"]
