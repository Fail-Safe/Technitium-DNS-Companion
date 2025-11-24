#!/usr/bin/env python3
"""
Convert hardcoded colors to CSS variables in App.css

This script replaces common hardcoded color values with CSS custom properties
for dark mode support.
"""

import re
from pathlib import Path

# Color mapping: hardcoded value -> CSS variable
COLOR_MAPPINGS = {
    # Backgrounds
    r'background:\s*#ffffff(?=;|\s)': 'background: var(--color-bg-secondary)',
    r'background-color:\s*#ffffff(?=;|\s)': 'background-color: var(--color-bg-secondary)',
    r'background:\s*#f6f8fb(?=;|\s)': 'background: var(--color-bg-primary)',
    r'background-color:\s*#f6f8fb(?=;|\s)': 'background-color: var(--color-bg-primary)',
    r'background:\s*#f0f4f8(?=;|\s)': 'background: var(--color-bg-tertiary)',
    r'background-color:\s*#f0f4f8(?=;|\s)': 'background-color: var(--color-bg-tertiary)',
    
    # Text colors
    r'color:\s*#1a1f2d(?=;|\s)': 'color: var(--color-text-primary)',
    r'color:\s*#5a6e8b(?=;|\s)': 'color: var(--color-text-secondary)',
    r'color:\s*#8896aa(?=;|\s)': 'color: var(--color-text-tertiary)',
    
    # Borders
    r'border:\s*1px solid #dce3ee(?=;|\s)': 'border: 1px solid var(--color-border)',
    r'border:\s*2px solid #dce3ee(?=;|\s)': 'border: 2px solid var(--color-border)',
    r'border-color:\s*#dce3ee(?=;|\s)': 'border-color: var(--color-border)',
    r'border-bottom:\s*1px solid #dce3ee(?=;|\s)': 'border-bottom: 1px solid var(--color-border)',
    r'border-top:\s*1px solid #dce3ee(?=;|\s)': 'border-top: 1px solid var(--color-border)',
    r'border-left:\s*1px solid #dce3ee(?=;|\s)': 'border-left: 1px solid var(--color-border)',
    r'border-right:\s*1px solid #dce3ee(?=;|\s)': 'border-right: 1px solid var(--color-border)',
}

def convert_colors(content: str) -> tuple[str, int]:
    """
    Convert hardcoded colors to CSS variables.
    Returns: (converted content, number of replacements)
    """
    replacements = 0
    result = content
    
    for pattern, replacement in COLOR_MAPPINGS.items():
        new_result, count = re.subn(pattern, replacement, result, flags=re.IGNORECASE)
        result = new_result
        replacements += count
    
    return result, replacements

def main():
    css_file = Path(__file__).parent.parent / 'src' / 'App.css'
    
    if not css_file.exists():
        print(f"❌ File not found: {css_file}")
        return 1
    
    print(f"📝 Reading {css_file.name}...")
    original_content = css_file.read_text()
    
    print("🔄 Converting colors...")
    new_content, replacements = convert_colors(original_content)
    
    if replacements == 0:
        print("✓ No changes needed - all colors already use variables!")
        return 0
    
    # Create backup
    backup_file = css_file.with_suffix('.css.bak')
    backup_file.write_text(original_content)
    print(f"💾 Backup created: {backup_file.name}")
    
    # Write converted content
    css_file.write_text(new_content)
    print(f"✅ Converted {replacements} color values to CSS variables")
    print(f"   Original size: {len(original_content)} bytes")
    print(f"   New size: {len(new_content)} bytes")
    
    return 0

if __name__ == '__main__':
    exit(main())
