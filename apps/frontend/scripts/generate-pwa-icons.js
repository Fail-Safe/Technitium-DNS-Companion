#!/usr/bin/env node

/**
 * Generate PWA icons from SVG source
 * This script creates PNG icons in multiple sizes required for PWA
 */

import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { APP_NAME, APP_SHORT_NAME, APP_DESCRIPTION } from '../app.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Required icon sizes for PWA
const ICON_SIZES = [
    { size: 192, name: 'icon-192x192.png', purpose: 'any' },
    { size: 512, name: 'icon-512x512.png', purpose: 'any' },
    { size: 192, name: 'icon-192x192-maskable.png', purpose: 'maskable' },
    { size: 512, name: 'icon-512x512-maskable.png', purpose: 'maskable' },
    { size: 180, name: 'apple-touch-icon.png', purpose: 'apple' }, // iOS
];

// For this basic implementation, we'll create a simple placeholder
// In a real implementation, you'd use sharp or canvas to render the SVG
console.log('Note: Using SVG as fallback. For production, consider generating PNG icons with sharp or imagemagick.');
console.log('For now, browsers will use the SVG icon which works for most PWA use cases.\n');

const publicDir = join(__dirname, '..', 'public');
const svgContent = readFileSync(join(publicDir, 'icon.svg'), 'utf-8');

// Create a simple HTML file that references the SVG
// Most modern browsers support SVG icons directly in manifests
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
        {
            src: '/icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
        },
        // Fallback to vite.svg if needed
        {
            src: '/vite.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
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
            icons: [{ src: '/icon.svg', sizes: '96x96' }]
        },
        {
            name: 'DNS Zones',
            short_name: 'Zones',
            description: 'Manage DNS zones',
            url: '/zones',
            icons: [{ src: '/icon.svg', sizes: '96x96' }]
        }
    ]
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('✓ Created manifest.json');
console.log('✓ PWA will use SVG icons (supported by modern browsers)');
console.log('\nTo generate PNG icons for better compatibility, install sharp:');
console.log('  npm install --save-dev sharp');
console.log('  Then run: node scripts/generate-pwa-icons-with-sharp.js\n');
