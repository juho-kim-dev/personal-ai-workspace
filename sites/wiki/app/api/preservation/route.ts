import { getChatGPTUser } from '../../chatgpt-auth';
import { WikiError } from '../../../lib/wiki-store';
import { boundedJSON } from '../../../lib/request-body';
import { requireCurrentWikiBrowser } from '../../../lib/wiki-browser-protocol';
import * as server from '../../../lib/wiki-preservation-server';
export const dynamic = 'force-dynamic';
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (e: unknown) => json({ error: e instanceof WikiError ? e.message : '보존 요청을 처리하지 못했습니다.' }, e instanceof WikiError ? e.status : 500);
async function auth(req: Request, write = false) {
    if (!await getChatGPTUser())
        throw new WikiError('로그인이 필요합니다.', 401);
    if (write) {
        if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin)
            throw new WikiError('허용되지 않은 요청입니다.', 403);
        await requireCurrentWikiBrowser(req);
    }
}
export async function GET(req: Request) {
    try {
        await auth(req);
        const q = new URL(req.url).searchParams, id = q.get('package_id'), object = q.get('object');
        if (object && !id)
            throw new WikiError('패키지 식별자가 필요합니다.');
        if (id)
            return object ? await server.getPreservationObject(id, object) : json(await server.getPreservation(id));
        return json(await server.listPreservation(q.get('cursor') || undefined));
    }
    catch (e) {
        return failure(e);
    }
}
export async function PUT(req: Request) {
    try {
        await auth(req, true);
        const q = new URL(req.url).searchParams;
        return json(await server.uploadPreservation(server.preservationId(q.get('upload_id'), true), server.preservationId(q.get('object')), req.body));
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    try {
        await auth(req, true);
        const b = await boundedJSON(req, 1572864);
        if (!b || typeof b !== 'object' || Array.isArray(b))
            throw new WikiError('잘못된 요청입니다.');
        const allowed: Record<string, string[]> = { begin: ['op', 'manifest_base64'], inspect: ['op', 'upload_id'], commit: ['op', 'upload_id'], preview: ['op', 'package_id'], apply: ['op', 'package_id', 'fingerprint'], export: ['op'] };
        if (typeof b.op !== 'string' || !Object.hasOwn(allowed, b.op) || Object.keys(b).some(k => !allowed[b.op].includes(k)))
            throw new WikiError('지원하지 않는 요청입니다.');
        switch (b.op) {
            case 'begin': return json(await server.beginPreservation(b.manifest_base64));
            case 'inspect': return json(await server.inspectPreservation(server.preservationId(b.upload_id, true)));
            case 'commit': return json(await server.commitPreservation(server.preservationId(b.upload_id, true)));
            case 'preview': return json(await server.previewPreservation(server.preservationId(b.package_id)));
            case 'apply': return json(await server.applyPreservation(server.preservationId(b.package_id), b.fingerprint));
            case 'export': return json(await server.exportPreservation());
        }
    }
    catch (e) {
        return failure(e);
    }
}
