import * as React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'privacy | kimo',
  description: 'how kimo handles files and ai processing',
};
export default function PrivacyPage() {
  return (
    <main className="privacy-page" data-ready="true">
      <Link href="/">back to kimo</Link>
      <h1 tabIndex={-1} data-route-focus>
        privacy
      </h1>
      <p>
        by sending, you agree that your files are processed by ai models. don’t
        upload anything private.
      </p>
      <h2>file storage</h2>
      <p>
        the production policy calls for files to be stored in cloudflare r2 and
        automatically deleted after 24 hours. final videos are kept for 30 days.
      </p>
      <p>
        this preview uses synthetic test infrastructure. production storage,
        deletion and retention have not yet been verified against the backend.
      </p>
      <h2>ai processing</h2>
      <p>
        the production workflow sends inputs to meta model api models. meta may
        use these inputs to improve its models. do not upload private,
        confidential or sensitive files.
      </p>
      <h2>contact</h2>
      <p>
        questions about your files or this policy? email{' '}
        <a href="mailto:hello@getkimo.tech">hello@getkimo.tech</a>.
      </p>
    </main>
  );
}
