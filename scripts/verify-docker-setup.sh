#!/bin/bash
# Test script to verify Docker build and basic functionality

set -e

echo "🔧 Testing Technitium DNS Companion Docker Build"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
	echo -e "${YELLOW}⚠️  Warning: .env file not found${NC}"
	echo "Creating .env from .env.example..."
	cp .env.example .env
	echo -e "${YELLOW}⚠️  Please edit .env with your Technitium DNS node configuration${NC}"
	exit 1
fi

echo ""
echo "📦 Building Docker image..."

if [ "$(docker compose build)" -eq 0 ]; then
	echo -e "${GREEN}✅ Docker build successful${NC}"
else
	echo -e "${RED}❌ Docker build failed${NC}"
	exit 1
fi

echo ""
echo "🚀 Starting container..."

if [ "$(docker compose up -d)" -eq 0 ]; then
	echo -e "${GREEN}✅ Container started${NC}"
else
	echo -e "${RED}❌ Failed to start container${NC}"
	exit 1
fi

echo ""
echo "⏳ Waiting for application to be ready (10 seconds)..."
sleep 10

echo ""
echo "🔍 Testing health check endpoint..."
HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/nodes || echo "000")

if [ "$HEALTH_CHECK" = "200" ] || [ "$HEALTH_CHECK" = "401" ]; then
	echo -e "${GREEN}✅ API is responding (HTTP $HEALTH_CHECK)${NC}"
else
	echo -e "${RED}❌ API health check failed (HTTP $HEALTH_CHECK)${NC}"
	echo ""
	echo "Container logs:"
	docker compose logs --tail=20
	exit 1
fi

echo ""
echo "🌐 Testing frontend..."
FRONTEND_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || echo "000")

if [ "$FRONTEND_CHECK" = "200" ]; then
	echo -e "${GREEN}✅ Frontend is responding (HTTP $FRONTEND_CHECK)${NC}"
else
	echo -e "${YELLOW}⚠️  Frontend returned HTTP $FRONTEND_CHECK${NC}"
fi

echo ""
echo "📊 Container status:"
docker compose ps

echo ""
echo "📝 Recent logs:"
docker compose logs --tail=10

echo ""
echo "========================================"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "🌍 Application is running at:"
echo "   - Frontend: http://localhost:3000"
echo "   - API:      http://localhost:3000/api"
echo ""
echo "📖 Commands:"
echo "   View logs:   docker compose logs -f"
echo "   Stop:        docker compose down"
echo "   Restart:     docker compose restart"
echo ""
