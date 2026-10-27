import Link from 'next/link';
export default function NotFound() {
  return (
    <main data-ready="true" className="dev-page">
      <h1>this session doesn’t exist</h1>
      <p>check the link. this session may be unavailable or expired.</p>
      <Link href="/">start a new video</Link>
    </main>
  );
}
