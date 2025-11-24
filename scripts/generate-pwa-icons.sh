#!/bin/bash

# PWA Icon Generator
# Converts a source image into all required PWA icon sizes
# Requirements: ImageMagick (install via: brew install imagemagick)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_IMAGE="${1:-$PROJECT_ROOT/tsync.jpeg}"
OUTPUT_DIR="$PROJECT_ROOT/apps/frontend/public"

# Icon sizes to generate
# Format: "size:filename:purpose"
ICON_SPECS=(
	"96:icon-96x96.png:standard"
	"144:icon-144x144.png:standard"
	"192:icon-192x192.png:standard"
	"256:icon-256x256.png:standard"
	"384:icon-384x384.png:standard"
	"512:icon-512x512.png:standard"
	"192:icon-192x192-maskable.png:maskable"
	"512:icon-512x512-maskable.png:maskable"
)

# Print header
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  PWA Icon Generator${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if ImageMagick is installed
if ! command -v magick &>/dev/null; then
	echo -e "${RED}✗ Error: ImageMagick is not installed${NC}"
	echo -e "${YELLOW}  Install it with: brew install imagemagick${NC}"
	exit 1
fi

echo -e "${GREEN}✓ ImageMagick found: $(magick --version | head -n 1)${NC}"
echo ""

# Check if source image exists
if [ ! -f "$SOURCE_IMAGE" ]; then
	echo -e "${RED}✗ Error: Source image not found: $SOURCE_IMAGE${NC}"
	echo -e "${YELLOW}  Usage: $0 [path/to/source-image.jpg]${NC}"
	exit 1
fi

echo -e "${GREEN}✓ Source image: $SOURCE_IMAGE${NC}"
echo -e "${GREEN}✓ Output directory: $OUTPUT_DIR${NC}"
echo ""

# Get source image dimensions
SOURCE_INFO=$(magick identify -format "%wx%h %[colorspace] %[bit-depth]-bit" "$SOURCE_IMAGE")
echo -e "${BLUE}Source image info: $SOURCE_INFO${NC}"
echo ""

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Generate icons
echo -e "${YELLOW}Generating icons...${NC}"
echo ""

TOTAL=${#ICON_SPECS[@]}
CURRENT=0

for spec in "${ICON_SPECS[@]}"; do
	((CURRENT++))

	IFS=':' read -r size filename purpose <<<"$spec"
	output_path="$OUTPUT_DIR/$filename"

	echo -e "${BLUE}[$CURRENT/$TOTAL]${NC} Generating ${size}x${size} ($purpose)..."

	if [ "$purpose" = "maskable" ]; then
		# For maskable icons, add safe area padding (20% on each side)
		# This ensures the icon content isn't cut off by different mask shapes
		padding=$((size / 5)) # 20% padding
		inner_size=$((size - 2 * padding))

		magick "$SOURCE_IMAGE" \
			-resize "${inner_size}x${inner_size}" \
			-gravity center \
			-background transparent \
			-extent "${size}x${size}" \
			"$output_path"
	else
		# Standard icons - no padding needed
		magick "$SOURCE_IMAGE" \
			-resize "${size}x${size}" \
			-gravity center \
			-background transparent \
			-extent "${size}x${size}" \
			"$output_path"
	fi

	if [ -f "$output_path" ]; then
		file_size=$(du -h "$output_path" | cut -f1)
		echo -e "${GREEN}  ✓ Created: $filename ($file_size)${NC}"
	else
		echo -e "${RED}  ✗ Failed: $filename${NC}"
	fi
	echo ""
done

# Generate favicon.ico (16x16, 32x32, 48x48 multi-resolution)
echo -e "${BLUE}[BONUS]${NC} Generating favicon.ico (multi-resolution)..."
magick "$SOURCE_IMAGE" \
	-resize 16x16 \
	-gravity center \
	-background transparent \
	-extent 16x16 \
	"$OUTPUT_DIR/favicon-16.png"

magick "$SOURCE_IMAGE" \
	-resize 32x32 \
	-gravity center \
	-background transparent \
	-extent 32x32 \
	"$OUTPUT_DIR/favicon-32.png"

magick "$SOURCE_IMAGE" \
	-resize 48x48 \
	-gravity center \
	-background transparent \
	-extent 48x48 \
	"$OUTPUT_DIR/favicon-48.png"

magick "$OUTPUT_DIR/favicon-16.png" \
	"$OUTPUT_DIR/favicon-32.png" \
	"$OUTPUT_DIR/favicon-48.png" \
	"$OUTPUT_DIR/favicon.ico"

if [ -f "$OUTPUT_DIR/favicon.ico" ]; then
	file_size=$(du -h "$OUTPUT_DIR/favicon.ico" | cut -f1)
	echo -e "${GREEN}  ✓ Created: favicon.ico ($file_size)${NC}"

	# Clean up temporary files
	rm -f "$OUTPUT_DIR/favicon-16.png" "$OUTPUT_DIR/favicon-32.png" "$OUTPUT_DIR/favicon-48.png"
else
	echo -e "${RED}  ✗ Failed: favicon.ico${NC}"
fi
echo ""

# Generate apple-touch-icon.png (180x180)
echo -e "${BLUE}[BONUS]${NC} Generating apple-touch-icon.png (180x180)..."
magick "$SOURCE_IMAGE" \
	-resize 180x180 \
	-gravity center \
	-background transparent \
	-extent 180x180 \
	"$OUTPUT_DIR/apple-touch-icon.png"

if [ -f "$OUTPUT_DIR/apple-touch-icon.png" ]; then
	file_size=$(du -h "$OUTPUT_DIR/apple-touch-icon.png" | cut -f1)
	echo -e "${GREEN}  ✓ Created: apple-touch-icon.png ($file_size)${NC}"
else
	echo -e "${RED}  ✗ Failed: apple-touch-icon.png${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ Icon generation complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Generated icons:${NC}"
ls -lh "$OUTPUT_DIR"/icon-*.png "$OUTPUT_DIR"/favicon.ico "$OUTPUT_DIR"/apple-touch-icon.png 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Review the generated icons in: ${BLUE}$OUTPUT_DIR${NC}"
echo -e "  2. Update ${BLUE}apps/frontend/public/manifest.json${NC} if needed"
echo -e "  3. Update ${BLUE}apps/frontend/index.html${NC} to include favicon and apple-touch-icon"
echo -e "  4. Test PWA installation on various devices"
echo ""
