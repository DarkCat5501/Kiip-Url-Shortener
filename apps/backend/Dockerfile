FROM oven/bun:1 AS base
WORKDIR /app

# Copy backend package.json and install deps directly (no workspace)
COPY apps/backend/package.json ./
COPY apps/backend/bun.lock* ./
RUN bun install

# Copy backend source
COPY apps/backend/ ./
COPY .env.example ./

# Generate Prisma client
RUN bunx prisma generate

# Build
RUN bun run build

# Production
FROM oven/bun:1-slim AS production
WORKDIR /app

COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./
COPY --from=base /app/prisma ./prisma

EXPOSE 3000

# Run migrations and start
CMD ["sh", "-c", "bunx prisma migrate deploy && bun run dist/main.js"]