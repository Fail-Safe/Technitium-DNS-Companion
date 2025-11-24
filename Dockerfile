# Multi-stage build for Technitium DNS Companion
# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY apps/frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY apps/frontend/ ./

# Build frontend
RUN npm run build

# Stage 2: Build backend
FROM node:22-alpine AS backend-builder

WORKDIR /app/backend

# Copy backend package files
COPY apps/backend/package*.json ./
RUN npm ci

# Copy backend source
COPY apps/backend/ ./

# Build backend
RUN npm run build

# Stage 3: Production image
FROM node:22-alpine

WORKDIR /app

# Install production dependencies for backend
COPY apps/backend/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built backend from builder
COPY --from=backend-builder /app/backend/dist ./dist

# Copy built frontend from builder
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

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
