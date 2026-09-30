import Firm from '../components/Firm';
export const dynamic='force-dynamic';
export default function Page(){return <Firm terminalUrl={process.env.WJP_TERMINAL_PUBLIC_URL??'http://localhost:4310'}/>}
