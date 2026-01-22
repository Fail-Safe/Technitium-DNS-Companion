# syntax=docker/dockerfile:1.7
# Multi-stage build for Technitium DNS Companion (Monorepo)

ARG BUILDPLATFORM=linux/amd64
ARG NPM_VERSION=11.8.0


# Stage 0: Shared manifest context (reduces repeated COPY invalidations)
FROM --platform=$BUILDPLATFORM node:22-alpine3.21 AS manifest-context
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

# Stage 1: Build frontend
FROM --platform=$BUILDPLATFORM node:22-alpine3.21 AS frontend-builder
ARG BUILDPLATFORM
ARG NPM_VERSION

WORKDIR /app

# Copy package manifests from shared context (stable layer for caching)
COPY --from=manifest-context /app/ ./

# Install ALL dependencies to get platform-specific optional deps (Rollup binaries)
# --ignore-scripts skips native module compilation (not needed for frontend build)
# Explicitly install the matching Rollup native build to work around npm optional deps bug
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-fund --no-audit -g npm@${NPM_VERSION} && \
    npm ci --ignore-scripts --no-fund --no-audit \
    && case "$BUILDPLATFORM" in \
        linux/amd64*) npm install --no-save --no-fund --no-audit @rollup/rollup-linux-x64-musl @esbuild/linux-x64 ;; \
        linux/arm64*) npm install --no-save --no-fund --no-audit @rollup/rollup-linux-arm64-musl @esbuild/linux-arm64 ;; \
        *) echo "Skipping Rollup native binary install for BUILDPLATFORM=$BUILDPLATFORM" ;; \
      esac

# Copy frontend source
COPY apps/frontend/ ./apps/frontend/

# Build frontend
RUN npm run build --workspace=apps/frontend

# Stage 2: Build backend
FROM --platform=$BUILDPLATFORM node:22-alpine3.21 AS backend-builder
ARG NPM_VERSION

WORKDIR /app

# Copy manifests from shared context
COPY --from=manifest-context /app/ ./

# Install ALL dependencies (NestJS needs full dependency tree)
# --ignore-scripts skips native module compilation
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-fund --no-audit -g npm@${NPM_VERSION} && \
    npm ci --ignore-scripts --no-fund --no-audit

# Copy backend source
COPY apps/backend/ ./apps/backend/

# Build backend
RUN npm run build --workspace=apps/backend

# Prune dev dependencies after build so the final image can copy only production deps.
# With npm workspaces, dependencies are typically hoisted to /app/node_modules (not apps/backend/node_modules).
RUN npm prune --omit=dev

# Stage 3: Production image
FROM node:22-alpine3.21

ARG BUILD_VERSION=unknown
ARG BUILD_REVISION=unknown

LABEL \
    org.opencontainers.image.title="Technitium DNS Companion" \
    org.opencontainers.image.description="Web UI to manage and sync multiple Technitium DNS servers (Technitium DNS Companion)" \
    org.opencontainers.image.url="https://github.com/Fail-Safe/Technitium-DNS-Companion" \
    org.opencontainers.image.source="https://github.com/Fail-Safe/Technitium-DNS-Companion" \
    org.opencontainers.image.documentation="https://fail-safe.github.io/Technitium-DNS-Companion" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.version="$BUILD_VERSION" \
    org.opencontainers.image.revision="$BUILD_REVISION"

WORKDIR /app

# Pull in latest Alpine security fixes for base packages
RUN apk upgrade --no-cache

# Copy manifests from shared context
COPY --from=manifest-context /app/ ./

# Copy production dependencies from builder (npm workspaces hoist to /app/node_modules)
COPY --from=backend-builder /app/node_modules ./node_modules

# Copy built backend from builder
COPY --from=backend-builder /app/apps/backend/dist ./apps/backend/dist

# Copy built frontend from builder (Nest serves from apps/frontend/dist)
COPY --from=frontend-builder /app/apps/frontend/dist ./apps/frontend/dist

# Create directory for environment file
RUN mkdir -p /app/config

# Ensure backend-local node_modules are on the module resolution path
ENV NODE_PATH=/app/apps/backend/node_modules:/app/node_modules

# Expose ports
# Default HTTP: 3000, Default HTTPS: 3443
EXPOSE 3000 3443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["node", "apps/backend/dist/main"]
