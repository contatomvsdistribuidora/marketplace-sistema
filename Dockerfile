FROM node:20-alpine

RUN corepack enable

WORKDIR /app

# Copy package manifests and patches first (layer cache)
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Install all dependencies (dev deps needed at runtime: vite is imported by
# server/_core/vite.ts even in the production code path via ESM top-level import)
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build frontend (vite → dist/public) + backend (esbuild → dist/index.js)
RUN pnpm build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
