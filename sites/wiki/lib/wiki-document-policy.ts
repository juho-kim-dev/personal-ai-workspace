import {wikiNamespace} from './wiki-title';
import {redirectTarget} from './wiki-text';

/** Operational policy; neither a new storage type nor a restriction on ordinary documents. */
export function wikiDocumentPolicy(title:string,content:string) {
    const namespace=wikiNamespace(title),redirect=redirectTarget(content);
    const roles=[...(namespace?[namespace]:[]),...(redirect?['넘겨주기']:[])];
    return {kind:roles.length?'특수 문서':'일반 문서',namespace:namespace||'기본',roles};
}
