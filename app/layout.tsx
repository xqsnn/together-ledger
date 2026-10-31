import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'两人账本 · 把日子记在一起',description:'两个人，一本账。一起记录收支，慢慢积攒生活。',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
