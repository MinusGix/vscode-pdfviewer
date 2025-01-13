/**
 * Toggles markdown blockquote symbols ('> ') at the start of each line in the given text
 * @param text The text to process
 * @returns The text with blockquote symbols toggled
 */
export function toggleBlockquote(text: string): string {
    if (!text) {
        return text;
    }

    const lines = text.split('\n');
    const allLinesQuoted = lines.every(line => 
        line === '' || line === '>' || line.startsWith('> ')
    );
    
    return lines
        .map(line => {
            if (allLinesQuoted) {
                // Remove blockquote
                return line.replace(/^>[ ]?/, '');
            } else {
                // Add blockquote if not present
                if (line === '') {
                    return '>';
                }
                return line.startsWith('> ') ? line : `> ${line}`;
            }
        })
        .join('\n');
}
