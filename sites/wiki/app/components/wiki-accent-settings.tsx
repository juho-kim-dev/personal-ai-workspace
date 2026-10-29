'use client';

import { useId } from 'react';
import { WIKI_ACCENT_PRESETS, type WikiAccent } from '../../lib/wiki-theme';

export function WikiAccentSettings({ value, onChange }: {
    value: WikiAccent;
    onChange: (value: WikiAccent) => void;
}) {
    const id = useId();
    return <fieldset className="wiki-accent-settings" aria-describedby={`${id}-help`}>
        <legend>강조 색상</legend>
        <p id={`${id}-help`}>상단 바와 주요 조작의 강조 색상을 선택하세요. 기본은 차콜 상단 바와 파란 조작의 안내서 테마이며, 밝은 화면과 어두운 화면에 함께 적용됩니다. 문서 본문의 링크는 파란색을 유지합니다.</p>
        <div className="wiki-accent-options">
            {WIKI_ACCENT_PRESETS.map(preset => <label className="wiki-accent-option" key={preset.key}>
                <input type="radio" name={`${id}-accent`} value={preset.key}
                    checked={value === preset.key} aria-label={preset.label} aria-describedby={`${id}-${preset.key}-hint`}
                    onChange={event => { if (event.currentTarget.checked) onChange(preset.key); }} />
                <span className="wiki-accent-swatch" data-accent-swatch={preset.key} aria-hidden="true" />
                <span>{preset.label}<small id={`${id}-${preset.key}-hint`}>{preset.description}</small></span>
            </label>)}
        </div>
    </fieldset>;
}
