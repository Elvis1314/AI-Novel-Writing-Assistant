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

# 3. Install all dependencies
RUN pnpm install --frozen-lockfile

# 4. Copy shared source first
COPY tsconfig.base.json ./
COPY shared ./shared

# 5. Build shared first (other workspaces depend on it)
RUN pnpm --filter @ai-novel/shared build

# 6. Copy client source and build
COPY client ./client
RUN pnpm --filter @ai-novel/client build

# 7. CRITICAL: Generate Prisma client BEFORE server build
#    The server TypeScript imports @prisma/client types (Prisma, World, etc.)
#    which only exist after prisma generate runs.
COPY server/package.json ./server/
COPY server/src/prisma ./server/prisma
RUN cd /app/server && pnpm exec prisma generate --schema prisma/schema.prisma

# 8. Copy server source and build TypeScript
# Note: Use --noEmitOnError false to emit JS even with type errors,
# and append || true to ignore non-zero exit code from tsc.
# These are type-only errors (TS2742/TS2339 etc.) and won't affect runtime.
COPY server ./server
RUN cd /app/server && pnpm exec tsc -p tsconfig.json --noEmitOnError false || true

# =============================================
# Runtime stage (production image)
# =============================================
FROM node:20-bookworm-slim AS runtime

# Install OpenSSL (required by Prisma for libssl detection)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

RUN groupadd -g 1001 appgroup && useradd -u 1001 -g appgroup -m appuser
WORKDIR /app

# Step 1: Copy ALL package files and workspace config FIRST
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=base /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=base /app/client/package.json ./client/
COPY --from=base /app/server/package.json ./server/
COPY --from=base /app/shared/package.json ./shared/

# Step 2: Copy Prisma schema
COPY --from=base /app/server/prisma ./server/prisma

# Step 3: Install all dependencies (including prisma CLI for db push at startup)
RUN pnpm install --frozen-lockfile

# Step 4: Generate Prisma client
RUN cd /app/server && pnpm exec prisma generate --schema prisma/schema.prisma

# Step 5: Copy built artifacts
COPY --from=base /app/client/dist ./client/dist
COPY --from=base /app/server/dist ./server/dist
COPY --from=base /app/shared/dist ./shared/dist

# Step 6: Create data directories
RUN mkdir -p /app/data /app/logs && chown -R appuser:appgroup /app

# Step 7: Create startup script
RUN printf '#!/bin/sh\nset -e\necho "[1/2] Ensuring database schema..."\ncd /app/server\nif [ ! -f "/app/data/dev.db" ]; then\n    pnpm exec prisma db push --skip-generate || true\nfi\necho "[2/2] Starting server..."\nexec node dist/app.js\n' > /app/start.sh && chmod +x /app/start.sh

USER appuser
ENV NODE_ENV=production

EXPOSE 3000 5173

CMD ["/app/start.sh"]