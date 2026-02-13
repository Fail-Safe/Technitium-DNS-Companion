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

# Stage 2b: Install backend production dependencies only
FROM --platform=$BUILDPLATFORM node:22-alpine3.21 AS backend-runtime-deps
ARG NPM_VERSION

WORKDIR /app

# Copy manifests from shared context
COPY --from=manifest-context /app/ ./

# Install production dependencies only for backend workspace
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-fund --no-audit -g npm@${NPM_VERSION} && \
    npm ci --omit=dev --no-fund --no-audit --workspace=apps/backend

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

# Add init for proper signal handling and zombie reaping
RUN apk add --no-cache dumb-init

# Copy manifests from shared context
COPY --from=manifest-context --chown=node:node /app/ ./

# Copy production dependencies from runtime-deps stage
COPY --from=backend-runtime-deps --chown=node:node /app/node_modules ./node_modules

# Copy built backend from builder
COPY --from=backend-builder --chown=node:node /app/apps/backend/dist ./apps/backend/dist

# Copy built frontend from builder (Nest serves from apps/frontend/dist)
COPY --from=frontend-builder --chown=node:node /app/apps/frontend/dist ./apps/frontend/dist

# Create runtime directories (session/cert/tmp paths) and grant write access to non-root user
RUN mkdir -p /app/config /app/tmp /data/certs/self-signed && \
    chown -R node:node /app/config /app/tmp /data

ENV NODE_ENV=production

# Ensure backend-local node_modules are on the module resolution path
ENV NODE_PATH=/app/apps/backend/node_modules:/app/node_modules

# Run as non-root user
USER node

# Expose ports
# Default HTTP: 3000, Default HTTPS: 3443
EXPOSE 3000 3443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const http=require('http');const https=require('https');const checks=[()=>new Promise((resolve)=>{const req=https.get({hostname:'127.0.0.1',port:Number(process.env.HTTPS_PORT||3443),path:'/api/health',rejectUnauthorized:false},(r)=>resolve(r.statusCode===200));req.on('error',()=>resolve(false));req.setTimeout(5000,()=>{req.destroy();resolve(false);});}),()=>new Promise((resolve)=>{const req=http.get({hostname:'127.0.0.1',port:Number(process.env.PORT||3000),path:'/api/health'},(r)=>resolve(r.statusCode===200));req.on('error',()=>resolve(false));req.setTimeout(5000,()=>{req.destroy();resolve(false);});})];(async()=>{for(const check of checks){if(await check()){process.exit(0);}}process.exit(1);})();"

# Run under init for proper signal forwarding
ENTRYPOINT ["dumb-init", "--"]

# Run the application
CMD ["node", "apps/backend/dist/main"]
