#!/bin/bash
# Deploy AnixOps to Cloudflare
# Usage: ./deploy.sh [--preview] [--production]

set -e

MODE="${1:---preview}"
BRANCH=$(git branch --show-current)

echo "🚀 Deploying AnixOps to Cloudflare..."
echo "   Mode: $MODE"
echo "   Branch: $BRANCH"

# Step 1: Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Step 2: Build Next.js frontend for Cloudflare Pages
echo ""
echo "🔨 Building Next.js frontend..."
npm run pages:build

# Step 3: Deploy Pages
echo ""
echo "📄 Deploying to Cloudflare Pages..."
if [ "$MODE" = "--production" ]; then
  wrangler pages deploy .vercel/output/static --project-name=anixops --branch="$BRANCH"
else
  wrangler pages deploy .vercel/output/static --project-name=anixops --branch="$BRANCH" --commit-dirty
fi

# Step 4: Deploy Worker API
echo ""
echo "⚡ Deploying Cloudflare Worker API..."
if [ "$MODE" = "--production" ]; then
  wrangler deploy
else
  wrangler deploy --env preview
fi

echo ""
echo "✅ Deploy complete!"
