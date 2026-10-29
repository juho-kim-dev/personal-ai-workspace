import type { Metadata } from 'next';
import './globals.css';
import './discussions-v5.css';
import './wiki-hierarchy.css';
export const metadata:Metadata={title:'PAW - Wiki — Personal AI Workspace',description:'원문과 근거를 연결하는 PAW의 위키와 중심 작업공간',robots:{index:false,follow:false},icons:{icon:'/paw-icons/wiki.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
