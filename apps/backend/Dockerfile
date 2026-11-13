FROM oven/bun:1 AS build
WORKDIR /app

COPY apps/backend/package.json ./
COPY apps/backend/bun.lock* ./
RUN bun install

COPY apps/backend/ ./
RUN bun run build

FROM oven/bun:1-slim AS production
WORKDIR /app

COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
