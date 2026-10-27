import * as React from 'react';
import Link from 'next/link';
import '@/styles/ui.css';
import '@/styles/warmup.css';
export default function SessionNotFound() {
  return (
    <main className="session-error-screen" data-ready="true">
      <section>
        <h1>this session doesn’t exist</h1>
        <p>check the link. this session may be unavailable or expired.</p>
        <div className="session-error-actions">
          <Link href="/" className="ui-button ui-button-primary" data-size="md">
            <span className="ui-button-label">start a new video</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
