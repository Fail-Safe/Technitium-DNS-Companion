# Health Check API

## Overview

The Health Check API provides endpoints for monitoring the health and status of the Technitium DNS Companion application. This API is designed to work with both Docker container health checks and external monitoring tools.

## Endpoints

### Basic Health Check

**Endpoint:** `GET /api/health`

**Description:** Provides a lightweight health check suitable for Docker health checks and basic monitoring.

**Authentication:** Public (no authentication required)

**Response Time:** Fast (<10ms typically)

**Example Request:**
```bash
curl http://localhost:3000/api/health
```

**Example Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-20T02:45:00.000Z",
  "uptime": 3600
}
```

**Response Fields:**
- `status` (string): Always returns `"ok"` when the service is running
- `timestamp` (string): ISO 8601 timestamp of when the health check was performed
- `uptime` (number): Application uptime in seconds

### Detailed Health Check

**Endpoint:** `GET /api/health?detailed=true`

**Description:** Provides comprehensive health information including node connectivity status and cluster information. Useful for monitoring dashboards and troubleshooting.

**Authentication:** Public (no authentication required)

**Response Time:** Depends on node count and network latency

**Example Request:**
```bash
curl http://localhost:3000/api/health?detailed=true
```

**Example Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-20T02:45:00.000Z",
  "uptime": 3600,
  "version": "1.3.0",
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

**Additional Response Fields (detailed mode):**
- `version` (string): Application version
- `environment` (string): Node environment (production, development, etc.)
- `nodes` (object): Node health information
  - `configured` (number): Total number of configured nodes
  - `healthy` (number): Number of nodes responding successfully
  - `unhealthy` (number): Number of nodes that failed health checks
  - `details` (array): Array of node health details
    - `id` (string): Node identifier
    - `name` (string): Node display name
    - `baseUrl` (string): Node base URL
    - `status` (string): `"healthy"`, `"unhealthy"`, or `"unknown"`
    - `responseTime` (number, optional): Response time in milliseconds
    - `error` (string, optional): Error message if unhealthy
    - `clusterState` (object, optional): Cluster membership information
      - `initialized` (boolean): Whether the node is part of a cluster
      - `type` (string): `"Primary"`, `"Secondary"`, or `"Standalone"`
      - `health` (string): Cluster health status

**Unhealthy Node Example:**
```json
{
  "id": "node3",
  "name": "DNS Offline",
  "baseUrl": "https://dns-offline.example.com:53443",
  "status": "unhealthy",
  "responseTime": 5002,
  "error": "Connection timeout",
  "clusterState": {
    "initialized": false,
    "type": "Standalone"
  }
}
```

## Docker Health Check

The Dockerfile includes a built-in health check that uses the basic health endpoint:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
```

**Configuration:**
- **Interval:** 30 seconds between checks
- **Timeout:** 10 seconds maximum response time
- **Start Period:** 40 seconds grace period on container startup
- **Retries:** 3 failed checks before marking container as unhealthy

## Docker Compose Health Check

You can also configure health checks in `docker-compose.yml`:

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

## External Monitoring

### Prometheus/Grafana

You can use the detailed health check endpoint with Prometheus blackbox exporter or create a custom exporter:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'technitium-companion'
    metrics_path: '/api/health'
    params:
      detailed: ['true']
    static_configs:
      - targets: ['localhost:3000']
```

### Uptime Kuma

Add a new HTTP monitor:
- **Monitor Type:** HTTP(s)
- **URL:** `http://your-server:3000/api/health`
- **Heartbeat Interval:** 60 seconds
- **Expected Status Code:** 200

For detailed monitoring, use:
- **URL:** `http://your-server:3000/api/health?detailed=true`
- **Keyword:** `"status":"ok"`

### Nagios/Icinga

Example check command:

```bash
#!/bin/bash
# check_technitium_companion.sh

RESPONSE=$(curl -s -w "%{http_code}" http://localhost:3000/api/health?detailed=true)
HTTP_CODE="${RESPONSE: -3}"
BODY="${RESPONSE%???}"

if [ "$HTTP_CODE" -ne 200 ]; then
  echo "CRITICAL - HTTP $HTTP_CODE"
  exit 2
fi

HEALTHY=$(echo "$BODY" | jq -r '.nodes.healthy // 0')
UNHEALTHY=$(echo "$BODY" | jq -r '.nodes.unhealthy // 0')

if [ "$UNHEALTHY" -gt 0 ]; then
  echo "WARNING - $UNHEALTHY unhealthy nodes"
  exit 1
fi

echo "OK - All $HEALTHY nodes healthy"
exit 0
```

### Custom Monitoring Script

```python
#!/usr/bin/env python3
import requests
import sys

def check_health():
    try:
        response = requests.get('http://localhost:3000/api/health?detailed=true', timeout=10)
        response.raise_for_status()
        
        data = response.json()
        
        if data.get('status') != 'ok':
            print(f"ERROR: Status is {data.get('status')}")
            return 1
        
        nodes = data.get('nodes', {})
        unhealthy = nodes.get('unhealthy', 0)
        
        if unhealthy > 0:
            print(f"WARNING: {unhealthy} unhealthy nodes")
            for node in nodes.get('details', []):
                if node.get('status') == 'unhealthy':
                    print(f"  - {node['name']}: {node.get('error', 'Unknown error')}")
            return 1
        
        healthy = nodes.get('healthy', 0)
        print(f"OK: All {healthy} nodes healthy")
        return 0
        
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return 2

if __name__ == '__main__':
    sys.exit(check_health())
```

## Usage Examples

### Check if service is running
```bash
curl -f http://localhost:3000/api/health || echo "Service is down"
```

### Get detailed status
```bash
curl -s http://localhost:3000/api/health?detailed=true | jq .
```

### Check node health from script
```bash
#!/bin/bash
HEALTH=$(curl -s http://localhost:3000/api/health?detailed=true)
UNHEALTHY=$(echo "$HEALTH" | jq -r '.nodes.unhealthy')

if [ "$UNHEALTHY" -gt 0 ]; then
  echo "Warning: $UNHEALTHY unhealthy nodes detected"
  echo "$HEALTH" | jq -r '.nodes.details[] | select(.status=="unhealthy") | "\(.name): \(.error)"'
  exit 1
fi
```

## Performance Considerations

- **Basic Health Check:** Very fast (<10ms), uses minimal resources
- **Detailed Health Check:** Response time depends on:
  - Number of configured nodes
  - Network latency to each node
  - Node responsiveness
  
For frequent health checks (e.g., Docker container health), use the basic endpoint without the `detailed` parameter.

For monitoring dashboards and troubleshooting, use the detailed endpoint but with appropriate intervals (e.g., 30-60 seconds).

## Troubleshooting

### Health check returns 401 Unauthorized

The health check endpoint is marked as `@Public()` and should not require authentication. If you're getting 401 errors:
1. Verify you're accessing `/api/health` (not `/health`)
2. Check if you have custom authentication middleware interfering
3. Review backend logs for authentication issues

### Detailed health shows all nodes as unhealthy

Possible causes:
1. **Node credentials not configured:** Ensure environment variables are set
2. **Network connectivity:** Check if backend can reach node URLs
3. **Technitium DNS not running:** Verify Technitium DNS services are up
4. **SSL certificate issues:** Check certificate validity if using HTTPS

### Docker health check always failing

1. **Check container logs:** `docker logs technitium-dns-companion`
2. **Verify port binding:** Ensure container port 3000 is accessible internally
3. **Increase start period:** Application may need more time to start
4. **Test manually:** `docker exec technitium-dns-companion node -e "require('http').get('http://localhost:3000/api/health', (r) => {console.log(r.statusCode)})"`

## Security Considerations

The health check endpoint is intentionally public (no authentication required) to support:
- Docker container health checks
- Load balancer health probes
- Monitoring systems

**Security implications:**
- Basic health check reveals minimal information (service is running)
- Detailed health check reveals:
  - Node names and URLs (but not credentials)
  - Cluster topology
  - Response times

**Recommendations:**
- Use basic health check for public-facing load balancers
- Restrict detailed health check to trusted networks if concerned about information disclosure
- Consider using a reverse proxy to limit access to `/api/health?detailed=true`

## Future Enhancements

Potential improvements for future versions:
- Readiness vs. liveness checks (Kubernetes-style)
- Configurable health check levels
- Metrics endpoint (Prometheus format)
- Historical health data
- Alerting integration
