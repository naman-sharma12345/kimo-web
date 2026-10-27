# Geist font provenance

Unmodified variable WOFF2 fonts copied from the installed `geist@1.8.2` package:

- `dist/fonts/geist-sans/Geist-Variable.woff2` to `geist-sans-variable.woff2`
- `dist/fonts/geist-mono/GeistMono-Variable.woff2` to `geist-mono-variable.woff2`

The package's `LICENSE.txt` is copied verbatim as `geist-OFL.txt`. It states copyright (c) 2023 Vercel, in collaboration with basement.studio, and SIL Open Font License 1.1. These are bundled, not renamed font families or modified font binaries. CSS uses the actual Geist and Geist Mono family aliases, also used by compositor Canvas text styles. No external font service is needed.

The observed `/__nextjs_font/geist-latin.woff2` request belongs to Next development tools, not the application's published font assets. Only that exact overlay font is allowed by the preview gateway after an upstream middleware test verifies it serves installed WOFF2 bytes. Other private Next development routes and arbitrary font paths remain denied. Application fonts use the two exact public paths above, served by Next's public directory. The development-overlay font and application fonts are distinct; this does not misattribute the overlay 404 to the application font download. The middleware test does not constitute a new live-browser validation.
