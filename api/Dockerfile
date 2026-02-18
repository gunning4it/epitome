# =====================================================
# EPITOME API SERVER - MULTI-STAGE DOCKER BUILD
# =====================================================
# Stage 1: Builder - Install dependencies and compile TypeScript
# Stage 2: Production - Minimal runtime image
# =====================================================

# -----------------------------------------------------
# STAGE 1: Builder
# -----------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies (including dev deps for build)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Prune dev dependencies for production
RUN npm prune --omit=dev

# -----------------------------------------------------
# STAGE 2: Production Runtime
# -----------------------------------------------------
FROM node:22-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy production-only dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled JavaScript
COPY --from=builder /app/dist ./dist

# Copy package.json for metadata
COPY package*.json ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the API server
CMD ["node", "dist/index.js"]
