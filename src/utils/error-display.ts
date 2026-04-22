/**
 * Generate an error SVG to display on a Stream Deck button.
 */
export function generateErrorSVG(message: string): string {
    // Split message into lines if too long (max ~12 chars per line)
    const lines: string[] = [];
    const words = message.split(' ');
    let current = '';
    for (const word of words) {
        if (current && (current + ' ' + word).length > 14) {
            lines.push(current);
            current = word;
        } else {
            current = current ? current + ' ' + word : word;
        }
    }
    if (current) lines.push(current);

    // Limit to 3 lines
    const displayLines = lines.slice(0, 3);
    const startY = 72 - ((displayLines.length - 1) * 14);
    const textElements = displayLines
        .map((line, i) => `<text x="72" y="${startY + i * 28}" font-family="Arial, sans-serif" font-size="18" fill="#FFFFFF" text-anchor="middle">${escapeXml(line)}</text>`)
        .join('');

    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
            <rect width="144" height="144" fill="#991b1b"/>
            ${textElements}
        </svg>
    `)}`;
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Show a temporary error on a button, then restore its normal state.
 */
export async function showButtonError(
    action: any,
    message: string,
    restoreCallback: () => Promise<void>,
    durationMs = 3000
): Promise<void> {
    await action.setImage(generateErrorSVG(message));
    setTimeout(() => {
        restoreCallback().catch(() => {});
    }, durationMs);
}
