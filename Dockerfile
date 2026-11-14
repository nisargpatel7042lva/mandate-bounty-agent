# Agent image: the Hono API plus the watcher (review, zkTLS, mandate proof, zkVerify, payout).
# Runs TypeScript directly with Node 22 type stripping, like `pnpm --filter @mba/agent start`.
FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.7.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/agent/package.json apps/agent/
COPY packages/circuits/package.json packages/circuits/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY packages/zktls/package.json packages/zktls/
COPY packages/zkverify/package.json packages/zkverify/
RUN pnpm install --frozen-lockfile --prod --filter "@mba/agent..."
COPY apps/agent apps/agent
COPY packages packages

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/mandate-bounty.sqlite
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/agent
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "--no-warnings", "src/server.ts"]
