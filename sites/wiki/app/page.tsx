import { requireChatGPTUser } from './chatgpt-auth';
import WikiApp from './wiki-app';
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/');return <WikiApp/>}
