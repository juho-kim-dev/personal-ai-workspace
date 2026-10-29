import { lineDiff } from '../../lib/wiki-ui-state';
export function WikiDiff({ before, after, left = '기준 원문', right = '변경 원문' }: {
    before: string;
    after: string;
    left?: string;
    right?: string;
}) {
    const diff = lineDiff(before, after);
    return <section className="diff-panel" aria-label="원문 비교"><div className="diff-labels"><strong>{left}</strong><strong>{right}</strong></div>{diff.fallback ? <><p className="notice">문서가 커서 줄 정렬 비교 대신 두 원문을 표시합니다.</p><div className="raw-columns"><pre>{before}</pre><pre>{after}</pre></div></> : <div className="aligned-diff">{diff.rows.map((row, i) => <div className={'diff-row ' + row.kind} key={i}><pre className={row.kind === 'change' && row.left ? 'removed' : ''}><span>{row.left}</span>{row.before ?? ' '}</pre><pre className={row.kind === 'change' && row.right ? 'added' : ''}><span>{row.right}</span>{row.after ?? ' '}</pre></div>)}</div>}</section>;
}
