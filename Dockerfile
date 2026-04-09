# AI Novel Writing Assistant - Production Dockerfile
# Multi-stage build for monorepo (client + server + shared)

FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/
COPY scripts/package.json ./scripts/
RUN pnpm install --frozen-lockfile
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY tsconfig.base.json ./
RUN pnpm --filter @ai-novel/shared build
RUN pnpm --filter @ai-novel/client build
RUN pnpm --filter @ai-novel/server build

FROM node:20-bookworm-slim AS runtime
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
RUN groupadd -g 1001 appgroup && useradd -u 1001 -g appgroup -m appuser
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/client/dist ./client/dist
COPY --from=base /app/server/dist ./server/dist
COPY --from=base /app/shared/dist ./shared/dist
COPY --from=base /app/server/package.json ./server/
COPY --from=base /app/server/prisma ./server/prisma
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/pnpm-lock.yaml ./
COPY --from=base /app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
RUN mkdir -p /app/data /app/logs && chown -R appuser:appgroup /app

# Create startup script using printf (Docker-safe, no heredoc)
RUN printf '#!/bin/sh\n' > /app/start.sh && \
    printf 'set -e\n' >> /app/start.sh && \
    printf 'echo "Generating Prisma client..."\n' >> /app/start.sh && \
    printf 'cd /app/server\n' >> /app/start.sh && \
    printf 'npx prisma generate --schema src/prisma/schema.prisma\n' >> /app/start.sh && \
    printf 'echo "Pushing database schema..."\n' >> /app/start.sh && \
    printf 'npx prisma db push --schema src/prisma/schema.prisma --skip-generate\n' >> /app/start.sh && \
    printf 'echo "Starting server..."\n' >> /app/start.sh && \
    printf 'cd /app\n' >> /app/start.sh && \
    printf 'exec pnpm --filter @ai-novel/server start\n' >> /app/start.sh && \
    chmod +x /app/start.sh

USER appuser
ENV NODE_ENV=production

EXPOSE 3000 5173

CMD ["/app/start.sh"]
