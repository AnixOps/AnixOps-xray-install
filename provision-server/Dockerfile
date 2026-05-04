# Build stage
FROM node:22-slim AS builder

WORKDIR /app
COPY provision-server/package*.json ./
RUN npm ci
COPY provision-server/tsconfig.json ./
COPY provision-server/src/ ./src/
RUN npm run build

# Production stage
FROM node:22-slim AS runner

WORKDIR /app

# Create non-root user
RUN groupadd -r anixops && useradd -r -g anixops -d /app -s /sbin/nologin anixops

COPY provision-server/package*.json ./
RUN npm install --production

# Copy built JS from builder
COPY --from=builder /app/dist ./dist

# Copy protocol scripts (vless-reality.sh, hysteria2.sh, destroy.sh)
COPY scripts/ ./scripts/

# Create .ssh directory with proper permissions
RUN mkdir -p /app/.ssh && chown anixops:anixops /app/.ssh && chmod 700 /app/.ssh

# Set proper ownership for app files
RUN chown -R anixops:anixops /app

USER anixops

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "dist/server.js"]
