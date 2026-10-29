// This marks compatible browser code; authentication remains the server's job.
export const WIKI_CLIENT_HEADER = 'X-Wiki42-Client';
export const WIKI_CLIENT_PROTOCOL = 'document-identity-v1';
export const WIKI_CLIENT_HEADERS = { [WIKI_CLIENT_HEADER]: WIKI_CLIENT_PROTOCOL };
