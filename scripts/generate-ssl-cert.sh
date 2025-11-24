#!/bin/bash
# Generate self-signed SSL certificates for development/testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="${SCRIPT_DIR}/../certs"

echo "🔐 Technitium-DNS-Companion SSL Certificate Generator"
echo "=============================================="
echo ""
echo "This will generate a self-signed certificate for HTTPS development."
echo ""

# Get configuration from user
echo "Certificate Configuration"
echo "-------------------------"
read -r -p "Common Name (CN) [localhost]: " CN
CN=${CN:-localhost}

read -r -p "Days valid [365]: " DAYS
DAYS=${DAYS:-365}

echo ""
echo "Subject Alternative Names (SANs)"
echo "--------------------------------"
echo "Enter additional DNS names and IP addresses (one per line, empty to finish)"
echo "Examples: technitium.example.com, 192.168.1.100, dns-companion.local"
echo ""

DNS_NAMES=("localhost" "$CN")
IP_ADDRESSES=("127.0.0.1")

echo "DNS names (press Enter with empty input to finish):"
while true; do
    read -r -p "  DNS: " dns_name
    if [ -z "$dns_name" ]; then
        break
    fi
    DNS_NAMES+=("$dns_name")
done

echo ""
echo "IP addresses (press Enter with empty input to finish):"
while true; do
    read -r -p "  IP: " ip_addr
    if [ -z "$ip_addr" ]; then
        break
    fi
    IP_ADDRESSES+=("$ip_addr")
done

# Create certs directory if it doesn't exist
mkdir -p "$CERTS_DIR"

# Check if certificates already exist
if [ -f "$CERTS_DIR/server.crt" ] && [ -f "$CERTS_DIR/server.key" ]; then
    echo ""
    echo "⚠️  Certificates already exist in: $CERTS_DIR"
    echo ""
    read -r -p "Overwrite existing certificates? (y/N): " -n 1
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted. Existing certificates preserved."
        exit 0
    fi
fi

echo ""
echo "Generating certificate..."

# Create OpenSSL config file
CONFIG_FILE="$CERTS_DIR/openssl.cnf"

    cat > "$CONFIG_FILE" <<EOF
[req]
default_bits = 2048
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = State
L = City
O = Technitium-DNS-Companion
OU = Development
CN = $CN

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment, keyAgreement
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
EOF

# Add DNS names
DNS_COUNT=1
for dns in "${DNS_NAMES[@]}"; do
    echo "DNS.$DNS_COUNT = $dns" >> "$CONFIG_FILE"
    ((DNS_COUNT++))
done

# Add IP addresses
IP_COUNT=1
for ip in "${IP_ADDRESSES[@]}"; do
    echo "IP.$IP_COUNT = $ip" >> "$CONFIG_FILE"
    ((IP_COUNT++))
done

# Generate private key
openssl genrsa -out "$CERTS_DIR/server.key" 2048 2>/dev/null

# Generate certificate
openssl req -new -x509 -nodes \
    -key "$CERTS_DIR/server.key" \
    -out "$CERTS_DIR/server.crt" \
    -days "$DAYS" \
    -config "$CONFIG_FILE" \
    -extensions v3_req 2>/dev/null

# Set appropriate permissions
chmod 600 "$CERTS_DIR/server.key"
chmod 644 "$CERTS_DIR/server.crt"

echo "✅ Certificate generated successfully!"
echo ""
echo "📁 Location: $CERTS_DIR"
echo "   - Certificate: server.crt"
echo "   - Private Key: server.key"
echo "   - Config: openssl.cnf"

echo ""
echo "📋 Certificate Details:"
openssl x509 -in "$CERTS_DIR/server.crt" -noout -subject -dates -ext subjectAltName

echo ""
echo "🔧 Configuration for .env:"
echo ""
echo "   HTTPS_ENABLED=true"
echo "   HTTPS_CERT_PATH=./certs/server.crt"
echo "   HTTPS_KEY_PATH=./certs/server.key"

echo ""
echo "⚠️  Self-Signed Certificate Warning"
echo "   These certificates are for DEVELOPMENT/TESTING only."
echo "   Browsers will show security warnings until you trust the certificate."
echo ""
echo "   To trust the certificate:"
echo ""
echo "   macOS:"
echo "     sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CERTS_DIR/server.crt"
echo ""
echo "   Linux (Ubuntu/Debian):"
echo "     sudo cp $CERTS_DIR/server.crt /usr/local/share/ca-certificates/technitium-dns-companion.crt"
echo "     sudo update-ca-certificates"
echo ""
echo "   For production, use Let's Encrypt: https://letsencrypt.org"
echo ""
echo "✅ Done!"
