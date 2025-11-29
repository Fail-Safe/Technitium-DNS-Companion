# syntax=docker/dockerfile:1.7
# Multi-stage build for Technitium DNS Companion (Monorepo)


# Stage 0: Shared manifest context (reduces repeated COPY invalidations)
FROM node:22-alpine AS manifest-context
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder
ARG TARGETARCH

WORKDIR /app

# Copy package manifests from shared context (stable layer for caching)
COPY --from=manifest-context /app/ ./

# Install ALL dependencies to get platform-specific optional deps (Rollup binaries)
# --ignore-scripts skips native module compilation (not needed for frontend build)
# Explicitly install the matching Rollup native build to work around npm optional deps bug
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts \
    && if [ "$TARGETARCH" = "amd64" ]; then \
    npm install --no-save @rollup/rollup-linux-x64-musl @esbuild/linux-x64; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
    npm install --no-save @rollup/rollup-linux-arm64-musl @esbuild/linux-arm64; \
    else \
    echo "Skipping Rollup native binary install for arch $TARGETARCH"; \
    fi

# Copy frontend source
COPY apps/frontend/ ./apps/frontend/

# Build frontend
RUN npm run build --workspace=apps/frontend

# Stage 2: Build backend
FROM node:22-alpine AS backend-builder

WORKDIR /app

# Copy manifests from shared context
COPY --from=manifest-context /app/ ./

# Install ALL dependencies (NestJS needs full dependency tree)
# --ignore-scripts skips native module compilation
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# Copy backend source
COPY apps/backend/ ./apps/backend/

# Build backend
RUN npm run build --workspace=apps/backend

# Stage 3: Production image
FROM node:22-alpine

WORKDIR /app

# Copy manifests from shared context
COPY --from=manifest-context /app/ ./

# Install production dependencies only for backend
RUN --mount=type=cache,target=/root/.npm npm ci --workspace=apps/backend --omit=dev && npm cache clean --force

# Copy built backend from builder
COPY --from=backend-builder /app/apps/backend/dist ./dist

# Copy built frontend from builder
COPY --from=frontend-builder /app/apps/frontend/dist ./frontend/dist

# Create directory for environment file
RUN mkdir -p /app/config

# Expose ports
# Default HTTP: 3000, Default HTTPS: 3443
EXPOSE 3000 3443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/nodes', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["node", "dist/main"]
