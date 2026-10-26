import Link from 'next/link';
export default function NotFound() {
  return (
    <main data-ready="true" className="dev-page">
      <h1>this session doesn’t exist</h1>
      <p>it may have expired. sessions are kept for 24 hours.</p>
      <Link href="/">start a new video</Link>
    </main>
  );
}
