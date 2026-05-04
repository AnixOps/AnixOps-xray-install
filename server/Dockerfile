FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY server/package.json server/package-lock.json* ./
RUN npm ci

# Copy source
COPY server/tsconfig.json ./
COPY server/src ./src
COPY versions.json /versions.json

# Build TypeScript
RUN npm run build

# Production image
FROM node:22-alpine AS production

WORKDIR /app

# Install wget for healthcheck
RUN apk add --no-cache wget

# Copy package files
COPY server/package.json server/package-lock.json* ./
RUN npm ci --only=production

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /versions.json /versions.json

EXPOSE 8787

USER node

CMD ["node", "dist/index.js"]
