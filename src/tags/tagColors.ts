/**
 * Tag color utilities - generates consistent colors from tag names
 */

/**
 * Simple string hash function (FNV-1a)
 */
function hashString(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash >>> 0) * 0x01000193;
    hash >>>= 0;
  }
  return hash >>> 0;
}

/**
 * VS Code theme color IDs that work well for tags
 * These change with the theme, providing visual variety
 */
export const THEME_COLOR_IDS = [
  'charts.red',
  'charts.blue',
  'charts.yellow',
  'charts.orange',
  'charts.green',
  'charts.purple',
  'terminal.ansiRed',
  'terminal.ansiGreen',
  'terminal.ansiYellow',
  'terminal.ansiBlue',
  'terminal.ansiMagenta',
  'terminal.ansiCyan',
  'gitDecoration.modifiedResourceForeground',
  'gitDecoration.addedResourceForeground',
  'gitDecoration.untrackedResourceForeground',
  'debugTokenExpression.string',
  'debugTokenExpression.number',
  'debugTokenExpression.boolean',
];

/**
 * Get a theme color ID for a tag based on its name hash
 * The color will change with the theme
 */
export function getThemeColorId(tagName: string): string {
  const hash = hashString(tagName.toLowerCase());
  const index = hash % THEME_COLOR_IDS.length;
  return THEME_COLOR_IDS[index];
}

/**
 * Generate a consistent color for a tag name.
 * Uses HSL for pleasant, readable colors.
 *
 * @param tagName The tag name (case insensitive)
 * @returns CSS HSL color string
 */
export function generateTagColor(tagName: string): string {
  const hash = hashString(tagName.toLowerCase());

  // Map hash to hue (0-360)
  // Use golden ratio for better distribution
  const hue = (hash * 137.508) % 360;

  // Fixed saturation and lightness for readability
  // Slightly varied based on hash for visual variety
  const saturation = 55 + (hash % 20); // 55-75%
  const lightness = 42 + ((hash >> 8) % 12); // 42-54%

  return `hsl(${Math.round(hue)}, ${saturation}%, ${lightness}%)`;
}

/**
 * Get the text color (black or white) that provides best contrast
 * against the given background color.
 *
 * @param bgColor CSS color string (hsl, hex, or rgb)
 * @returns 'black' or 'white'
 */
export function getContrastTextColor(bgColor: string): 'black' | 'white' {
  // Parse HSL color
  const hslMatch = bgColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (hslMatch) {
    const lightness = parseInt(hslMatch[3], 10);
    // If lightness > 55%, use black text, otherwise white
    return lightness > 55 ? 'black' : 'white';
  }

  // For hex colors (both 3-digit and 6-digit)
  // First try 6-digit hex
  let hexMatch = bgColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!hexMatch) {
    // Try 3-digit hex and expand it
    const shortHexMatch = bgColor.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);
    if (shortHexMatch) {
      // Expand 3-digit to 6-digit (e.g., #fff -> #ffffff)
      hexMatch = [
        bgColor,
        shortHexMatch[1] + shortHexMatch[1],
        shortHexMatch[2] + shortHexMatch[2],
        shortHexMatch[3] + shortHexMatch[3],
      ];
    }
  }
  if (hexMatch) {
    const r = parseInt(hexMatch[1], 16);
    const g = parseInt(hexMatch[2], 16);
    const b = parseInt(hexMatch[3], 16);
    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? 'black' : 'white';
  }

  // Default to white text for unknown formats
  return 'white';
}

/**
 * Validate if a string is a valid CSS color
 */
export function isValidColor(color: string): boolean {
  // Basic validation for common formats
  const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  const rgbRegex = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/;
  const rgbaRegex = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/;
  const hslRegex = /^hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\)$/;
  const namedColors = [
    'red',
    'blue',
    'green',
    'yellow',
    'orange',
    'purple',
    'pink',
    'cyan',
    'magenta',
    'lime',
    'teal',
    'indigo',
    'violet',
    'coral',
    'salmon',
    'gold',
    'silver',
    'gray',
    'grey',
    'black',
    'white',
    'maroon',
    'navy',
    'olive',
    'aqua',
    'fuchsia',
  ];

  return (
    hexRegex.test(color) ||
    rgbRegex.test(color) ||
    rgbaRegex.test(color) ||
    hslRegex.test(color) ||
    namedColors.includes(color.toLowerCase())
  );
}

/**
 * Get the effective color for a tag (custom or generated)
 */
export function getTagColor(tagName: string, customColor?: string): string {
  if (customColor && isValidColor(customColor)) {
    return customColor;
  }
  return generateTagColor(tagName);
}
