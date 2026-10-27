import { NextResponse, type NextRequest } from 'next/server';
import { securityHeaders } from '@/lib/security-headers';
export function middleware(request: NextRequest) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = btoa(String.fromCharCode(...bytes));
  const headers = securityHeaders(
    {
      production: process.env.NODE_ENV === 'production',
      api: process.env.NEXT_PUBLIC_KIMO_API,
      ws: process.env.NEXT_PUBLIC_KIMO_WS,
      media: process.env.KIMO_MEDIA_ORIGINS,
      telemetry: process.env.KIMO_TELEMETRY_ORIGINS,
    },
    nonce,
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(
    'Content-Security-Policy',
    headers['Content-Security-Policy'] ?? '',
  );
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers))
    response.headers.set(name, value);
  return response;
}
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|icon.svg|fonts/|grain.png|luts/|brand/).*)',
  ],
};
