import { env } from 'cloudflare:workers';
import { WikiError, titleInput } from './wiki-store';
import { inspectManifest, sha256, parseJson, config, WEB_PRESERVATION_BUDGETS } from './wiki-preservation-contract.mjs';
import { backupFingerprint, previewBackup, importBackup, exportBackup } from './wiki-backup';
import { validateStoredAttachment } from './attachments';
const ROOT = 'preservation-v1/';
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OPTIONS = {budgets:WEB_PRESERVATION_BUDGETS};
const encoder = new TextEncoder();
const fallback = '2026-10-23T00:00:00.000Z';
function parseNative(bytes:Uint8Array){return parseJson(bytes,config({budgets:{maxManifestBytes:24*1024*1024,maxStringChars:14*1024*1024}}).budgets);}
function fail(message: string, status = 400): never {
    throw new WikiError(message, status);
}
function bucket() {
    if (!env.BUCKET)
        fail('보존 저장소 연결이 필요합니다.', 503);
    return env.BUCKET;
}
export function preservationId(value: unknown, upload = false) {
    if (typeof value !== 'string' || !(upload ? UUID : HEX).test(value))
        fail('잘못된 보존 식별자입니다.');
    return value as string;
}
export function preservationBase64(bytes: Uint8Array) {
    let raw = '';
    for (let i = 0; i < bytes.length; i += 8192)
        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(raw);
}
function decode(value: unknown) {
    if (typeof value !== 'string' || value.length > 1398104 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
        fail('manifest base64 형식 또는 크기가 잘못되었습니다.');
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (preservationBase64(bytes) !== value)
        fail('정규 base64가 필요합니다.');
    return bytes;
}
async function checked(bytes: Uint8Array) {
    const result = await inspectManifest(bytes, OPTIONS);
    if (!result.report.can_import)
        fail('보존 manifest 검증에 실패했습니다.');
    const ext = result.manifest.wiki42_backup;
    if (ext !== undefined && (!ext || typeof ext !== 'object' || Array.isArray(ext) || Object.keys(ext).length !== 1 || !HEX.test(ext.content) || !result.objects.some((o: any) => o.sha256 === ext.content)))
        fail('wiki42_backup 확장이 잘못되었습니다.');
    return { ...result, bytes };
}
async function readManifest(key: string, id?: string) {
    const obj = await bucket().get(key);
    if (!obj)
        fail('보존 패키지를 찾을 수 없습니다.', 404);
    if (obj.size > 1048576)
        fail('manifest 크기 제한을 초과했습니다.');
    const result = await checked(new Uint8Array(await new Response(obj.body).arrayBuffer()));
    if (id && result.report.package_id !== id)
        fail('manifest 해시가 다릅니다.', 409);
    return result;
}
const stage = (id: string) => ROOT + 'uploads/' + preservationId(id, true) + '/';
const pkg = (id: string) => ROOT + 'packages/' + preservationId(id) + '/';
async function source(prefix: string, hash: string, staged: boolean) {
    if (!staged)
        return bucket().get(prefix + 'objects/' + hash);
    const ref = await bucket().get(prefix + 'refs/' + hash);
    if (!ref)
        return null;
    if (ref.size > 256)
        fail('업로드 참조가 잘못되었습니다.');
    const key = await new Response(ref.body).text();
    if (!key.startsWith(prefix + 'temporary/') || !UUID.test(key.slice((prefix + 'temporary/').length)))
        fail('업로드 참조가 잘못되었습니다.');
    return bucket().get(key);
}
// No object-sized buffers: DigestStream and the R2 sink consume the same bounded chunks.
async function digest(body: ReadableStream<Uint8Array>, expected: any, sink?: (stream: ReadableStream<Uint8Array>) => Promise<unknown>) {
    const Digest = (crypto as any).DigestStream;
    if (!Digest)
        fail('런타임 스트리밍 SHA-256을 사용할 수 없습니다.', 503);
    const hash = new Digest('SHA-256');
    const hashResult = hash.digest;
    hashResult.catch(() => {
    });
    const writer = hash.getWriter();
    let count = 0;
    const stream = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ async transform(chunk, controller) {
            count += chunk.byteLength;
            if (count > expected.bytes)
                fail('객체 크기가 선언과 다릅니다.');
            await writer.write(chunk);
            controller.enqueue(chunk);
        }, async flush() {
            await writer.close();
        } }));
    try {
        if (sink) {
            const Fixed = (globalThis as any).FixedLengthStream;
            if (!Fixed)
                fail('런타임 고정 길이 스트림을 사용할 수 없습니다.', 503);
            const fixed = new Fixed(expected.bytes);
            await Promise.all([stream.pipeTo(fixed.writable), sink(fixed.readable)]);
        }
        else {
            const reader = stream.getReader();
            while (!(await reader.read()).done) {
            }
        }
        const hex = Array.from(new Uint8Array(await hashResult), (x: number) => x.toString(16).padStart(2, '0')).join('');
        if (count !== expected.bytes || hex !== expected.sha256)
            fail('객체 크기 또는 SHA-256이 선언과 다릅니다.', 409);
    }
    catch (e) {
        await writer.abort().catch(() => {
        });
        throw e;
    }
}
async function verify(result: any, prefix: string, staged: boolean) {
    const report = JSON.parse(JSON.stringify(result.report));
    report.counts.verified_objects = 0;
    report.counts.verified_object_bytes = 0;
    for (const o of result.objects) {
        try {
            const obj = await source(prefix, o.sha256, staged);
            if (!obj)
                fail('선언된 객체가 없습니다.');
            await digest(new Response(obj.body).body!, o);
            report.counts.verified_objects++;
            report.counts.verified_object_bytes += o.bytes;
        }
        catch (e) {
            if (report.diagnostics.length < 512)
                report.diagnostics.push({ code: 'OBJECT_INVALID', severity: 'error', entity_id: o.sha256, message: e instanceof WikiError ? e.message : '객체를 검증하지 못했습니다.' });
            else
                report.diagnostics_omitted++;
            report.can_import = false;
            report.archive_integrity = 'invalid';
            report.content_completeness = 'unknown';
        }
    }
    if (report.can_import && result.manifest.wiki42_backup) {
        try {
            const hash = result.manifest.wiki42_backup.content;
            const declaration = result.objects.find((o: any) => o.sha256 === hash);
            if (declaration.bytes > 24 * 1024 ** 2)
                fail('기본 백업은 24 MiB 이하여야 합니다.', 413);
            const obj = await source(prefix, hash, staged);
            if (!obj)
                fail('기본 백업이 없습니다.');
            const native = parseNative(new Uint8Array(await new Response(obj.body).arrayBuffer()));
            if (!['my-wiki-v2', 'my-wiki-v3','my-wiki-v4'].includes(native?.format))
                fail('기본 백업 형식이 잘못되었습니다.');
            await backupFingerprint(native);
            report.native_counts=Object.fromEntries(['pages','revisions','notes','bookmarks','trash','threads','comments','files',...(native.format==='my-wiki-v4'?['knowledge']:[])].map(k=>[k,native[k].length]));
        }
        catch {
            report.can_import = false;
            report.archive_integrity = 'invalid';
            report.content_completeness = 'unknown';
            if (report.diagnostics.length < 512)
                report.diagnostics.push({ code: 'NATIVE_BACKUP_INVALID', severity: 'error', message: '기본 백업 스키마 검증에 실패했습니다.' });
            else
                report.diagnostics_omitted++;
        }
    }
    return report;
}
export async function beginPreservation(value: unknown) {
    const result = await checked(decode(value));
    const upload_id = crypto.randomUUID();
    await bucket().put(stage(upload_id) + 'manifest.json', result.bytes);
    return { upload_id, package_id: result.report.package_id, objects: result.objects };
}
export async function uploadPreservation(upload: string, hash: string, body: ReadableStream<Uint8Array> | null) {
    const prefix = stage(upload);
    preservationId(hash);
    const result = await readManifest(prefix + 'manifest.json');
    const declaration = result.objects.find((o: any) => o.sha256 === hash);
    if (!declaration || (!body && declaration.bytes !== 0))
        fail('선언된 객체 본문이 필요합니다.');
    if (!body)
        body = new Response(new Uint8Array()).body!;
    const key = prefix + 'temporary/' + crypto.randomUUID();
    await digest(body, declaration, stream => bucket().put(key, stream));
    await bucket().put(prefix + 'refs/' + hash, key);
    return { sha256: hash, bytes: declaration.bytes };
}
export async function inspectPreservation(upload: string) {
    const prefix = stage(upload);
    const result = await readManifest(prefix + 'manifest.json');
    return { report: await verify(result, prefix, true) };
}
async function publish(result: any, prefix: string) {
    const report = await verify(result, prefix, true);
    if (!report.can_import)
        return { package_id: report.package_id, report, disposition: 'rejected' };
    // Object names are content addressed. Conditional puts never replace a
    // prior archive, even when two uploads publish the same package together.
    const dest = pkg(report.package_id);
    for (const o of result.objects) {
        const key = dest + 'objects/' + o.sha256;
        const old = await bucket().get(key);
        if (old) {
            await digest(new Response(old.body).body!, o);
            continue;
        }
        const obj = await source(prefix, o.sha256, true);
        if (!obj)
            fail('객체가 사라졌습니다.', 409);
        await bucket().put(key, new Response(obj.body).body!, { onlyIf: { etagDoesNotMatch: '*' } });
    }
    const finalReport = await verify(result, dest, false);
    if (!finalReport.can_import)
        fail('게시 전 객체 검증에 실패했습니다.', 409);
    const old = await bucket().get(dest + 'manifest.json');
    if (old) {
        await readManifest(dest + 'manifest.json', report.package_id);
        return { package_id: report.package_id, report: finalReport, disposition: 'existing' };
    }
    // This is the sole visibility marker, written after the destination rehash.
    await bucket().put(dest + 'manifest.json', result.bytes, { onlyIf: { etagDoesNotMatch: '*' } });
    return { package_id: report.package_id, report: finalReport, disposition: 'committed' };
}
export async function commitPreservation(upload: string) {
    const prefix = stage(upload);
    return publish(await readManifest(prefix + 'manifest.json'), prefix);
}
export async function getPreservation(id: string) {
    const result = await readManifest(pkg(id) + 'manifest.json', id);
    return { manifest_base64: preservationBase64(result.bytes), report: await verify(result, pkg(id), false) };
}
export async function getPreservationObject(id: string, hash: string) {
    preservationId(hash);
    const result = await readManifest(pkg(id) + 'manifest.json', id);
    const o = result.objects.find((v: any) => v.sha256 === hash);
    if (!o)
        fail('선언되지 않은 객체입니다.', 404);
    const obj = await source(pkg(id), hash, false);
    if (!obj)
        fail('객체가 없습니다.', 404);
    await digest(new Response(obj.body).body!, o);
    const fresh = await source(pkg(id), hash, false);
    if (!fresh)
        fail('객체가 없습니다.', 404);
    return new Response(fresh.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + hash + '"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}
export async function listPreservation(cursor?: string) {
    if (cursor && (!/^[A-Za-z0-9+/=_-]{1,2048}$/.test(cursor)))
        fail('잘못된 목록 커서입니다.');
    const listing = await bucket().list({ prefix: ROOT + 'packages/', delimiter: '/', limit: 25, ...(cursor ? { cursor } : {}) });
    const packages = [];
    for (const prefix of listing.delimitedPrefixes) {
        const id = prefix.slice((ROOT + 'packages/').length, -1);
        if (!HEX.test(id))
            continue;
        try {
            const r = await readManifest(prefix + 'manifest.json', id);
            packages.push({ package_id: id, counts: r.report.counts, native_snapshot:!!r.manifest.wiki42_backup, archive_integrity: r.report.archive_integrity, content_completeness: r.report.content_completeness });
        }
        catch (e) {
            if (!(e instanceof WikiError && e.status === 404))
                throw e;
        }
    }
    return { packages, ...(listing.truncated ? { cursor: listing.cursor } : {}) };
}
async function conversion(id: string) {
    const prefix = pkg(id), r = await readManifest(prefix + 'manifest.json', id), report = await verify(r, prefix, false);
    if (!report.can_import)
        fail('보존 객체 검증에 실패했습니다.', 409);
    const m = r.manifest, warnings: string[] = [], archive_only: string[] = [];
    async function bytes(hash: string) {
        const o = await source(prefix, hash, false);
        if (!o)
            fail('객체가 없습니다.');
        return new Uint8Array(await new Response(o.body).arrayBuffer());
    }
    if (m.wiki42_backup) {
        // Native snapshots bypass the generic adapter so identity and every
        // supported native record reach the existing atomic importer intact.
        const raw = await bytes(m.wiki42_backup.content);
        if (raw.length > 24 * 1024 ** 2)
            fail('기본 백업은 24 MiB 이하여야 합니다.', 413);
        let backup: any;
        try {
            backup = parseNative(raw);
        }
        catch {
            fail('기본 백업 JSON이 잘못되었습니다.');
        }
        if (!['my-wiki-v2', 'my-wiki-v3','my-wiki-v4'].includes(backup?.format))
            fail('기본 백업 형식이 잘못되었습니다.');
        await backupFingerprint(backup);
        return { backup, titles: [...backup.pages, ...backup.trash].map((p: any) => p.title), warnings, archive_only: ['일반 manifest와 모든 객체·확장 메타데이터는 원본 아카이브에 보존됩니다.'] };
    }
    const backup: any = { format: 'my-wiki-v2', exported_at: fallback, pages: [], revisions: [], notes: [], bookmarks: [], threads: [], comments: [], trash: [], files: [] };
    let conversionBytes = 0;
    const reserve = (n: number) => {
        conversionBytes += n;
        if (conversionBytes > 24 * 1024 ** 2)
            fail('변환된 기본 백업은 24 MiB 이하여야 합니다.', 413);
    };
    const stable = async (entity: string) => sha256(encoder.encode(JSON.stringify([m.dataset.id, entity])));
    const date = (p: any) => {
        if (p?.observed_at && Number.isFinite(Date.parse(p.observed_at)))
            return p.observed_at;
        warnings.push('관측 날짜가 없어 고정 가져오기 날짜를 사용합니다. 원본 날짜가 아닙니다.');
        return fallback;
    };
    for (const d of m.documents) {
        const beforeDocument = conversionBytes;
        try {
            if (titleInput(d.title) !== d.title)
                throw new Error();
            const revs = m.revisions.filter((v: any) => v.document_id === d.id);
            const rows = [];
            for (const rev of revs) {
                if (!['text/plain', 'namumark', 'text/x-namumark'].includes(rev.syntax))
                    throw new Error();
                const declaration = r.objects.find((o: any) => o.sha256 === rev.content);
                if (!declaration || declaration.bytes > 800000)
                    throw new Error();
                reserve(declaration.bytes);
                const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await bytes(rev.content));
                if (content.length > 200000)
                    throw new Error();
                rows.push({ id: await stable(rev.id), title: d.title, content, summary: '', created_at: date(rev.provenance), size: Array.from(content.split('\0')[0]).length });
            }
            const headId = d.current_revision_id ? await stable(d.current_revision_id) : null;
            const actual = rows.find((v: any) => v.id === headId);
            if (!actual)
                throw new Error();
            backup.pages.push({ title: d.title, content: actual.content, version: actual.id, updated_at: actual.created_at });
            backup.revisions.push(...rows);
        }
        catch (error) {
            conversionBytes = beforeDocument;
            if (error instanceof WikiError && error.status === 413)
                throw error;
            archive_only.push('문서 ' + d.id + ': 제목·구문·UTF-8·크기 또는 현재 판이 호환되지 않아 모든 판을 보관 전용으로 유지합니다.');
        }
    }
    for (const media of m.media)
        for (const rep of media.representations) {
            const beforeMedia = conversionBytes;
            try {
                const declaration = r.objects.find((o: any) => o.sha256 === rep.content);
                if (!declaration || declaration.bytes > 10 * 1024 ** 2)
                    throw new Error();
                reserve(Math.ceil(declaration.bytes / 3) * 4);
                const raw = await bytes(rep.content);
                const meta = validateStoredAttachment(rep.source_filename, raw);
                backup.files.push({ ...meta, created_at: date(rep.provenance), sha256: rep.content, base64: preservationBase64(raw) });
                warnings.push('첨부파일로 변환: ' + meta.name);
            }
            catch (error) {
                conversionBytes = beforeMedia;
                if (error instanceof WikiError && error.status === 413)
                    throw error;
                archive_only.push('미디어 ' + rep.id + ': 호환되지 않는 형식·이름·크기, 원본 다운로드 가능.');
            }
        }
    for (const group of ['threads', 'comments', 'annotations', 'dependencies'])
        if (m[group].length)
            archive_only.push(group + ': ' + m[group].length + '개 보관 전용 (의미 필드 변환 없음).');
    if (m.documents.some((d: any) => d.aliases.length))
        archive_only.push('모든 별칭은 보관 전용입니다.');
    archive_only.push('원본 엔터티 ID·부모 판 관계·출처는 보관 전용입니다. 문서에는 정확한 제목·현재 본문·호환 판 본문·관측 날짜를 옮기며, 판 ID는 데이터셋 ID와 원본 판 ID에서 생성합니다.');
    archive_only.push('출처·알 수 없는 필드·바이너리를 포함한 모든 메타데이터와 객체는 정확한 원본 아카이브에 보존됩니다.');
    if (!backup.pages.length)
        warnings.push('가져올 수 있는 문서가 없습니다.');
    await backupFingerprint(backup);
    return { backup, titles: backup.pages.map((d: any) => d.title), warnings: [...new Set(warnings)], archive_only };
}
export async function previewPreservation(id: string) {
    const c = await conversion(id);
    const p = await previewBackup(c.backup);
    return { ...p, can_apply:p.can_apply&&Object.values(p.total_counts).some((n:any)=>n>0), titles: c.titles, archive_only: c.archive_only, warnings: [...p.warnings, ...c.warnings] };
}
export async function applyPreservation(id: string, fingerprint: unknown) {
    const c = await conversion(id);
    return importBackup(c.backup, fingerprint);
}
// The native backup already contains every record and attachment byte. Keep it
// once, rather than duplicating every revision/image as another R2 object.
export async function exportPreservation(){
 const backup=await exportBackup(),raw=encoder.encode(JSON.stringify(backup)),hash=await sha256(raw);
 const provenance={source:'Wiki42 snapshot',source_url:null,source_revision:null,attribution:{status:'unknown',text:null},observed_at:backup.exported_at};
 const manifest={format:'wiki42-preservation-v1',dataset:{id:'wiki42-snapshot',provenance},objects:[{sha256:hash,bytes:raw.length}],documents:[],revisions:[],media:[],threads:[],comments:[],annotations:[],dependencies:[],wiki42_backup:{content:hash}};
 const bytes=encoder.encode(JSON.stringify(manifest)),result=await checked(bytes),upload=crypto.randomUUID(),prefix=stage(upload),key=prefix+'temporary/'+crypto.randomUUID();
 await bucket().put(prefix+'manifest.json',bytes);await bucket().put(key,raw);await bucket().put(prefix+'refs/'+hash,key);
 return publish(result,prefix);
}
