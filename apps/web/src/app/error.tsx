'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main data-ready="true" className="dev-page">
      <h1>kimo couldn’t start this edit</h1>
      <p>
        the editor hit a problem before it began. your files are saved for 24
        hours.
      </p>
      <button onClick={reset}>try again</button>
      <a href="/">start over</a>
    </main>
  );
}
