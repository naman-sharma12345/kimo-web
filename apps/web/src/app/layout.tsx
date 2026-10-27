import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';
// Per-response CSP nonces require request-rendered HTML, not static inline-script HTML.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ),
  title: 'kimo · tell it the video',
  description:
    'drop in your clips, photos and music. kimo cuts, captions, grades and scores it while you watch, and you can step in at any second.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#route-main">
          skip to content
        </a>
        <div id="route-main" tabIndex={-1}>
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
