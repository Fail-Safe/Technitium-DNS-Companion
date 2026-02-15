# Health Check API Examples

This file demonstrates the health check API with example requests and responses.

## Basic Health Check

**Request:**
```bash
curl http://localhost:3000/api/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-20T02:54:00.000Z",
  "uptime": 3600
}
```

**Use Case:** Docker container health checks, basic uptime monitoring

---

## Detailed Health Check - All Nodes Healthy

**Request:**
```bash
curl -b cookies.txt http://localhost:3000/api/health/detailed
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-20T02:54:00.000Z",
  "uptime": 3600,
  "version": "1.3.1",
  "environment": "production",
  "nodes": {
    "configured": 2,
    "healthy": 2,
    "unhealthy": 0,
    "details": [
      {
        "id": "node1",
        "name": "DNS Primary",
        "baseUrl": "https://dns-primary.example.com:53443",
        "status": "healthy",
        "responseTime": 45,
        "clusterState": {
          "initialized": true,
          "type": "Primary",
          "health": "Connected"
        }
      },
      {
        "id": "node2",
        "name": "DNS Secondary",
        "baseUrl": "https://dns-secondary.example.com:53443",
        "status": "healthy",
        "responseTime": 52,
        "clusterState": {
          "initialized": true,
          "type": "Secondary",
          "health": "Connected"
        }
      }
    ]
  }
}
```

**Use Case:** Monitoring dashboard, status page, alerting systems

---

## Detailed Health Check - Mixed Health Status

**Request:**
```bash
curl -b cookies.txt http://localhost:3000/api/health/detailed
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-20T02:54:00.000Z",
  "uptime": 3600,
  "version": "1.3.1",
  "environment": "production",
  "nodes": {
    "configured": 3,
    "healthy": 2,
    "unhealthy": 1,
    "details": [
      {
        "id": "node1",
        "name": "DNS Primary",
        "baseUrl": "https://dns-primary.example.com:53443",
        "status": "healthy",
        "responseTime": 45,
        "clusterState": {
          "initialized": true,
          "type": "Primary",
          "health": "Connected"
        }
      },
      {
        "id": "node2",
        "name": "DNS Secondary",
        "baseUrl": "https://dns-secondary.example.com:53443",
        "status": "healthy",
        "responseTime": 52,
        "clusterState": {
          "initialized": true,
          "type": "Secondary",
          "health": "Connected"
        }
      },
      {
        "id": "node3",
        "name": "DNS Offline",
        "baseUrl": "https://dns-offline.example.com:53443",
        "status": "unhealthy",
        "responseTime": 5002,
        "error": "connect ETIMEDOUT",
        "clusterState": {
          "initialized": false,
          "type": "Standalone"
        }
      }
    ]
  }
}
```

**Use Case:** Alerting when nodes become unreachable, troubleshooting connectivity

---

## Integration Examples

### Docker Compose Health Check

```yaml
services:
  technitium-dns-companion:
    image: ghcr.io/fail-safe/technitium-dns-companion:latest
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 10s
      start_period: 40s
      retries: 3
```

### Shell Script Monitoring

```bash
#!/bin/bash
# check-health.sh - Simple health check script

RESPONSE=$(curl -b cookies.txt -s http://localhost:3000/api/health/detailed)
UNHEALTHY=$(echo "$RESPONSE" | jq -r '.nodes.unhealthy // 0')

if [ "$UNHEALTHY" -gt 0 ]; then
  echo "⚠️  Warning: $UNHEALTHY unhealthy nodes detected"
  echo "$RESPONSE" | jq -r '.nodes.details[] | select(.status=="unhealthy") | "  - \(.name): \(.error)"'
  exit 1
else
  HEALTHY=$(echo "$RESPONSE" | jq -r '.nodes.healthy // 0')
  echo "✅ All $HEALTHY nodes healthy"
  exit 0
fi
```

### Python Monitoring Script

```python
#!/usr/bin/env python3
import requests
import sys

def check_health():
    try:
    # `/api/health/detailed` requires an authenticated Companion session.
    # For scripting, authenticate first and reuse the session cookie.
    response = requests.get('http://localhost:3000/api/health/detailed', timeout=10)
        response.raise_for_status()

        data = response.json()
        nodes = data.get('nodes', {})

        unhealthy = nodes.get('unhealthy', 0)
        healthy = nodes.get('healthy', 0)

        if unhealthy > 0:
            print(f"⚠️  {unhealthy} unhealthy nodes:")
            for node in nodes.get('details', []):
                if node.get('status') == 'unhealthy':
                    print(f"  - {node['name']}: {node.get('error', 'Unknown error')}")
            return 1

        print(f"✅ All {healthy} nodes healthy (uptime: {data.get('uptime')}s)")
        return 0

    except Exception as e:
        print(f"❌ Health check failed: {str(e)}")
        return 2

if __name__ == '__main__':
    sys.exit(check_health())
```

### Prometheus Alerting Rule

```yaml
groups:
  - name: technitium_companion
    interval: 30s
    rules:
      - alert: TechnitiumCompanionDown
        expr: up{job="technitium-companion"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Technitium DNS Companion is down"
          description: "The Technitium DNS Companion service has been unreachable for 2 minutes"

      - alert: TechnitiumNodeUnhealthy
        expr: technitium_unhealthy_nodes > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Technitium DNS nodes are unhealthy"
          description: "{{ $value }} Technitium DNS nodes have been unhealthy for 5 minutes"
```

### Uptime Kuma Configuration

**Monitor Type:** HTTP(s)

**Settings:**
- **Friendly Name:** Technitium DNS Companion
- **URL:** `http://your-server:3000/api/health/detailed`
- **Heartbeat Interval:** 60 seconds
- **Retries:** 3
- **Expected Status Code:** 200
- **Keyword:** `"status":"ok"`
- **JSON Query:** Use `$.nodes.unhealthy` to track unhealthy nodes

---

## Response Field Reference

### Basic Health Check

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always "ok" when service is running |
| `timestamp` | string | ISO 8601 timestamp |
| `uptime` | number | Application uptime in seconds |

### Detailed Health Check (Additional Fields)

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Application version from package.json |
| `environment` | string | NODE_ENV value |
| `nodes.configured` | number | Total configured nodes |
| `nodes.healthy` | number | Nodes responding successfully |
| `nodes.unhealthy` | number | Nodes that failed health checks |
| `nodes.details` | array | Individual node health details |

### Node Detail Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Node identifier |
| `name` | string | Node display name |
| `baseUrl` | string | Node base URL |
| `status` | string | "healthy", "unhealthy", or "unknown" |
| `responseTime` | number | Response time in milliseconds (optional) |
| `error` | string | Error message if unhealthy (optional) |
| `clusterState` | object | Cluster membership info (optional) |
| `clusterState.initialized` | boolean | Whether node is in a cluster |
| `clusterState.type` | string | "Primary", "Secondary", or "Standalone" |
| `clusterState.health` | string | Cluster health status |
