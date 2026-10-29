/** Deliberately small, standalone-line YouTube syntax; null stays literal. */
export type WikiYouTubeMacro = Readonly<{
    provider: 'youtube';
    videoId: string;
    start: number;
    end: number | null;
    width: `${number}px` | `${number}%`;
    aspectRatio: number;
    align?: 'left' | 'center' | 'right';
}>;

function boundedInteger(value: string, min: number, max: number): number | null {
    // Canonical decimal only: no signs, fractions, exponents or leading zeros.
    if (!/^(?:0|[1-9][0-9]{0,5})$/.test(value)) return null;
    const number = Number(value);
    return number >= min && number <= max ? number : null;
}

/**
 * [youtube(ID[, start=N][, end=N][, width=N[px|%]][, height=N[px]][, align=left|center|right])]
 *
 * ID: exactly 11 ASCII letters/digits/_/-; options are unordered and unique.
 * Times: 0..86400 seconds, end > start (default 0), measured from video start.
 * Width: 200..1920 px or 1..100%; height: 200..1080 px, both integers.
 * Without height use 16:9; with height use pixel width (640 for % width).
 * Explicit proportions must remain between 1:4 and 4:1.
 * Only horizontal ASCII space is allowed; inputs over 256 chars are literal.
 */
export function parseWikiMedia(line: string): WikiYouTubeMacro | null {
    if (line.length > 256 || /[\x00-\x08\x0a-\x1f\x7f\u2028\u2029]/.test(line)) return null;
    const match = /^[ \t]*\[youtube\(([^()]*)\)\][ \t]*$/.exec(line);
    if (!match) return null;
    const parts = match[1].split(',');
    if (parts.length > 6) return null;
    const id = /^[ \t]*([A-Za-z0-9_-]{11})[ \t]*$/.exec(parts[0]);
    if (!id) return null;

    let start = 0, end: number | null = null, height: number | null = null;
    let width: WikiYouTubeMacro['width'] = '640px';
    let align: WikiYouTubeMacro['align'];
    const seen = new Set<string>();
    for (const part of parts.slice(1)) {
        const option = /^[ \t]*(start|end|width|height|align)[ \t]*=[ \t]*([^ \t]+)[ \t]*$/.exec(part);
        if (!option || seen.has(option[1])) return null;
        const [, name, value] = option;
        seen.add(name);
        if (name === 'align') {
            if (!['left','center','right'].includes(value)) return null;
            align = value as WikiYouTubeMacro['align'];
        } else if (name === 'start' || name === 'end') {
            const time = boundedInteger(value, 0, 86400);
            if (time === null) return null;
            if (name === 'start') start = time;
            else end = time;
        } else {
            const dimension = /^([0-9]+)(px|%)?$/.exec(value);
            if (!dimension) return null;
            const unit = dimension[2] || 'px';
            if (name === 'height' && unit === '%') return null;
            const size = boundedInteger(dimension[1], unit === '%' ? 1 : 200,
                unit === '%' ? 100 : name === 'width' ? 1920 : 1080);
            if (size === null) return null;
            if (name === 'height') height = size;
            else width = `${size}${unit as 'px' | '%'}`;
        }
    }
    if (end !== null && end <= start) return null;
    const nominalWidth = width.endsWith('px') ? Number.parseInt(width, 10) : 640;
    const aspectRatio = height === null ? 16 / 9 : nominalWidth / height;
    if (aspectRatio < 1 / 4 || aspectRatio > 4) return null;
    return { provider: 'youtube', videoId: id[1], start, end, width, aspectRatio, ...(align ? {align} : {}) };
}
