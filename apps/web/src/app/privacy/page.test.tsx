import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PrivacyPage from './page';
describe('privacy policy surface', () => {
  it('states the required processing, storage periods and contact without claiming backend verification', () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole('heading', { name: 'privacy', level: 1 }),
    ).toHaveAttribute('data-route-focus');
    expect(
      screen.getByText(
        'by sending, you agree that your files are processed by ai models. don’t upload anything private.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/cloudflare r2/)).toHaveTextContent('24 hours');
    expect(screen.getByText(/cloudflare r2/)).toHaveTextContent('30 days');
    expect(screen.getByText(/production storage,/)).toHaveTextContent(
      'have not yet been verified',
    );
    expect(screen.getByText(/meta model api/)).toHaveTextContent(
      'improve its models',
    );
    expect(
      screen.getByRole('link', { name: 'hello@getkimo.tech' }),
    ).toHaveAttribute('href', 'mailto:hello@getkimo.tech');
    expect(screen.getByRole('link', { name: 'back to kimo' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
