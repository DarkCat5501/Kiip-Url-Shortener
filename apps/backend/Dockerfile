FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
COPY apps/backend/package.json ./apps/backend/
RUN bun install --frozen-lockfile

# Copy source
COPY apps/backend/ ./apps/backend/
COPY .env.example ./

# Generate Prisma client
RUN cd apps/backend && bunx prisma generate

# Build
RUN cd apps/backend && bun run build

# Production
FROM oven/bun:1-slim AS production
WORKDIR /app

COPY --from=base /app/apps/backend/dist ./dist
COPY --from=base /app/apps/backend/node_modules ./node_modules
COPY --from=base /app/apps/backend/package.json ./

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]