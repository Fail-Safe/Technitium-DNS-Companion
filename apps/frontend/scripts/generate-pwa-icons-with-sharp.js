#!/usr/bin/env node

/**
 * Generate PWA icons from SVG source using sharp
 * Creates PNG icons in multiple sizes required for PWA
 */

import sharp from 'sharp';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { APP_NAME, APP_SHORT_NAME, APP_DESCRIPTION } from '../app.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'icon.svg');

// Ensure output directory exists
if (!existsSync(publicDir)) {
    mkdirSync(publicDir, { recursive: true });
}

// Required icon sizes for PWA
const ICON_SIZES = [
    { size: 192, name: 'icon-192x192.png', purpose: 'any' },
    { size: 512, name: 'icon-512x512.png', purpose: 'any' },
    { size: 192, name: 'icon-192x192-maskable.png', purpose: 'maskable', padding: 0.1 },
    { size: 512, name: 'icon-512x512-maskable.png', purpose: 'maskable', padding: 0.1 },
    { size: 180, name: 'apple-touch-icon.png', purpose: 'apple' }, // iOS
    { size: 96, name: 'icon-96x96.png', purpose: 'any' },
    { size: 144, name: 'icon-144x144.png', purpose: 'any' },
    { size: 256, name: 'icon-256x256.png', purpose: 'any' },
    { size: 384, name: 'icon-384x384.png', purpose: 'any' },
];

async function generateIcons() {
    console.log('🎨 Generating PWA icons from SVG...\n');

    // Read SVG file
    const svgBuffer = readFileSync(svgPath);

    // Generate each icon size
    for (const { size, name, purpose, padding } of ICON_SIZES) {
        try {
            const outputPath = join(publicDir, name);

            // Calculate size with padding for maskable icons
            const actualSize = padding ? Math.floor(size * (1 - padding * 2)) : size;
            const padSize = padding ? Math.floor((size - actualSize) / 2) : 0;

            if (padding) {
                // Maskable icons need padding (safe area)
                await sharp(svgBuffer)
                    .resize(actualSize, actualSize, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .extend({
                        top: padSize,
                        bottom: padSize,
                        left: padSize,
                        right: padSize,
                        background: { r: 15, g: 23, b: 42, alpha: 1 } // Match theme background
                    })
                    .png()
                    .toFile(outputPath);
            } else {
                // Regular icons
                await sharp(svgBuffer)
                    .resize(size, size, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .png()
                    .toFile(outputPath);
            }

            console.log(`✓ Generated ${name} (${size}x${size}) [${purpose}]`);
        } catch (error) {
            console.error(`✗ Failed to generate ${name}:`, error.message);
        }
    }

    // Update manifest with all icon sizes
    const manifestPath = join(publicDir, 'manifest.json');
    const manifest = {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: APP_DESCRIPTION,
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#4F46E5',
        icons: [
            // SVG (best quality)
            {
                src: '/icon.svg',
                sizes: '512x512',
                type: 'image/svg+xml',
                purpose: 'any'
            },
            // PNG icons
            {
                src: '/icon-192x192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/icon-512x512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/icon-192x192-maskable.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'maskable'
            },
            {
                src: '/icon-512x512-maskable.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable'
            },
            // Additional sizes
            {
                src: '/icon-96x96.png',
                sizes: '96x96',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/icon-144x144.png',
                sizes: '144x144',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/icon-256x256.png',
                sizes: '256x256',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: '/icon-384x384.png',
                sizes: '384x384',
                type: 'image/png',
                purpose: 'any'
            }
        ],
        orientation: 'portrait-primary',
        categories: ['utilities', 'productivity'],
        shortcuts: [
            {
                name: 'Query Logs',
                short_name: 'Logs',
                description: 'View DNS query logs',
                url: '/logs',
                icons: [{ src: '/icon-96x96.png', sizes: '96x96' }]
            },
            {
                name: 'DNS Zones',
                short_name: 'Zones',
                description: 'Manage DNS zones',
                url: '/zones',
                icons: [{ src: '/icon-96x96.png', sizes: '96x96' }]
            },
            {
                name: 'Configuration',
                short_name: 'Config',
                description: 'Sync DNS configuration',
                url: '/configuration',
                icons: [{ src: '/icon-96x96.png', sizes: '96x96' }]
            }
        ]
    };

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('\n✓ Updated manifest.json with PNG icons');
    console.log('\n🎉 All PWA icons generated successfully!');
    console.log('\nNext steps:');
    console.log('  1. Run: npm run build');
    console.log('  2. Test with: npm run preview');
    console.log('  3. Check DevTools → Application → Manifest');
}

// Run the generator
generateIcons().catch(error => {
    console.error('❌ Icon generation failed:', error);
    process.exit(1);
});
