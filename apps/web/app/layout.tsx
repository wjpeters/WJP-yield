import type { Metadata } from 'next';
import '@fontsource/inter/latin.css';
import '@fontsource/jetbrains-mono/latin.css';
import './globals.css';
export const metadata:Metadata={title:'WJP yield · Firm',description:'Traceerbare onderzoeksorganisatie en Strategie-lab'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="nl"><body>{children}</body></html>}
