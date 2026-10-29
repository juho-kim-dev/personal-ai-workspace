export const WIKI_ACCENT_KEYS = ['guide', 'green', 'charcoal', 'slate-navy', 'wikipedia', 'brand-blue', 'blue-charcoal', 'charcoal-navy'] as const;
export type WikiAccent = (typeof WIKI_ACCENT_KEYS)[number];
export const DEFAULT_WIKI_ACCENT: WikiAccent = 'guide';

/** Validate untrusted stored values without coercion, parsing, or browser access. */
export function isWikiAccent(value: unknown): value is WikiAccent {
    return value === 'guide' || value === 'green' || value === 'charcoal' || value === 'slate-navy' || value === 'wikipedia' || value === 'brand-blue' || value === 'blue-charcoal' || value === 'charcoal-navy';
}

export function readWikiAccent(value: unknown): WikiAccent {
    return isWikiAccent(value) ? value : DEFAULT_WIKI_ACCENT;
}

export const WIKI_ACCENT_PRESETS = [
    {
        key: 'guide', label: '안내서 기본', description: '차콜 외장 · 노란 표식 · 파란 연결',
        light: { accent: '#30373d', ink: '#2463b5', focus: '#2463b5' },
        dark: { accent: '#30373d', ink: '#a5c8f5', focus: '#a5c8f5' },
    },
    {
        key: 'green', label: '녹색', description: '익숙한 위키 녹색',
        light: { accent: '#00a495', ink: '#00756e', focus: '#00756e' },
        dark: { accent: '#008f87', ink: '#65d0c8', focus: '#65d0c8' },
    },
    {
        key: 'charcoal', label: '차콜', description: '차분한 흑연빛 회색',
        light: { accent: '#42464d', ink: '#34383f', focus: '#42464d' },
        dark: { accent: '#42464d', ink: '#c4c9d0', focus: '#c4c9d0' },
    },
    {
        key: 'slate-navy', label: '회색빛 네이비', description: '회색이 감도는 은은한 남색',
        light: { accent: '#4a5b70', ink: '#35465c', focus: '#4a5b70' },
        dark: { accent: '#4a5b70', ink: '#b5c7df', focus: '#b5c7df' },
    },
    {
        key: 'wikipedia', label: '위키피디아 블루', description: '위키미디어의 차분한 파란색',
        light: { accent: '#3366cc', ink: '#3366cc', focus: '#3366cc' },
        dark: { accent: '#3366cc', ink: '#88a3e8', focus: '#88a3e8' },
    },
    {
        key: 'brand-blue', label: 'PAW Wiki 블루', description: '원작 표지의 남색을 참고한 파랑',
        light: { accent: '#103068', ink: '#103068', focus: '#103068' },
        dark: { accent: '#103068', ink: '#a5c8f5', focus: '#a5c8f5' },
    },
    {
        key: 'blue-charcoal', label: '블루 차콜', description: '파란 기운과 흑연빛 회색의 균형',
        light: { accent: '#2b476c', ink: '#2b476c', focus: '#2b476c' },
        dark: { accent: '#2b476c', ink: '#b9cbe2', focus: '#b9cbe2' },
    },
    {
        key: 'charcoal-navy', label: '차콜 네이비', description: '회색에 남색이 은은하게 감도는 색',
        light: { accent: '#2e3d53', ink: '#2e3d53', focus: '#2e3d53' },
        dark: { accent: '#2e3d53', ink: '#bac7d9', focus: '#bac7d9' },
    },
] as const satisfies readonly {
    key: WikiAccent; label: string; description: string;
    light: { accent: string; ink: string; focus: string };
    dark: { accent: string; ink: string; focus: string };
}[];
