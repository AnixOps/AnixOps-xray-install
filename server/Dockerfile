FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production image
FROM node:22-alpine AS production

WORKDIR /app

# Install wget for healthcheck
RUN apk add --no-cache wget

# Copy package files
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy built files
COPY --from=builder /app/dist ./dist

EXPOSE 8787

USER node

CMD ["node", "dist/index.js"]
