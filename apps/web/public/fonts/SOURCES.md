# Bundled font provenance

These files are vendored for deterministic canvas/video text. They are not new
Studio chrome fonts. The adjacent OFL files contain the applicable licenses.

Retrieved 2026-10-27 from the Google Fonts upstream repository:

| File                           | Upstream source                                                                                     | SHA-256                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `anton-regular.ttf`            | `https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf`                   | `a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab` |
| `dm-serif-display-regular.ttf` | `https://raw.githubusercontent.com/google/fonts/main/ofl/dmserifdisplay/DMSerifDisplay-Regular.ttf` | `8cc3643535edf039aa5d95440a8542735e9197e4f4b8d9303e980fefbf5ab616` |

Anton uses `Anton-OFL.txt`; DM Serif Display uses
`DM-Serif-Display-OFL.txt`. Neither is claimed to be original kimo artwork.
Instrument Serif italic and its existing OFL remain bundled separately.
Geist Sans and Geist Mono remain supplied by the existing `geist` dependency.

Font availability and loading must be checked before final canvas text rendering.
Vendoring a file is not evidence that a screenshot or server render matches it.
