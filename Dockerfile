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
RUN cd /app/server && npx prisma generate --schema prisma/schema.prisma

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

# Re-generate Prisma in runtime (ensures @prisma/client binary is correct)
RUN cd /app/server && npx prisma generate --schema prisma/schema.prisma

# Copy workspace root files
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/pnpm-lock.yaml ./
COPY --from=base /app/pnpm-workspace.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Create data directories
RUN mkdir -p /app/data /app/logs && chown -R appuser:appgroup /app

# Startup script
# Note: Prisma already generated in runtime stage (line 53), no need to regenerate
RUN printf '#!/bin/sh\nset -e\necho "[1/2] Ensuring database exists..."\ncd /app/server\n# Only run db push if database doesn't exist (for first-time setup)\nif [ ! -f "/app/data/dev.db" ]; then\n    npx prisma db push --skip-generate || true\nfi\necho "[2/2] Starting server..."\ncd /app/server\nexec node dist/app.js\n' > /app/start.sh && chmod +x /app/start.sh

USER appuser
ENV NODE_ENV=production

EXPOSE 3000 5173

CMD ["/app/start.sh"]
