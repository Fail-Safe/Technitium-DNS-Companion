# Multi-stage build for Technitium DNS Companion (Monorepo)

# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# Copy all package files (workspaces need root context)
COPY package.json package-lock.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/

# Install ALL dependencies to get platform-specific optional deps (Rollup binaries)
# --ignore-scripts skips native module compilation (not needed for frontend build)
# Explicitly install Rollup's musl-native builds to work around npm optional deps bug
RUN npm ci --ignore-scripts \
    && npm install --no-save @rollup/rollup-linux-x64-musl @rollup/rollup-linux-arm64-musl

# Copy frontend source
COPY apps/frontend/ ./apps/frontend/

# Build frontend
RUN npm run build --workspace=apps/frontend

# Stage 2: Build backend
FROM node:22-alpine AS backend-builder

WORKDIR /app

# Copy all package files
COPY package.json package-lock.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/

# Install ALL dependencies (NestJS needs full dependency tree)
# --ignore-scripts skips native module compilation
RUN npm ci --ignore-scripts

# Copy backend source
COPY apps/backend/ ./apps/backend/

# Build backend
RUN npm run build --workspace=apps/backend

# Stage 3: Production image
FROM node:22-alpine

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/

# Install production dependencies only for backend
RUN npm ci --workspace=apps/backend --omit=dev && npm cache clean --force

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
