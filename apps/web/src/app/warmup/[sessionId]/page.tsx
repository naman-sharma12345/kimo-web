import { WarmupScreen } from '@/components/warmup/warmup-screen';
export default async function WarmupPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <WarmupScreen sessionId={sessionId} />;
}
