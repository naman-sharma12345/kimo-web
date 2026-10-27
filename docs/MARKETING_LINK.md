# Marketing navigation proposal

**Proposal only.** No marketing repository, DNS, service or deployment was changed.
The marketing site stays on `getkimo.tech`; the intended separate app hostname is
`app.getkimo.tech`. Availability and production readiness are unverified here.

Exact proposed snippet for the marketing owner:

```html
<a href="https://app.getkimo.tech">open the app</a>
```

Integrate into that site's existing navigation using its own styles and keyboard
focus treatment. Preserve the exact lowercase label and HTTPS destination. Do not
replace the marketing root, point it at an expired temporary preview, or infer
that adding this link deploys the app. Publish only after the deployment owner
has verified the destination and authorized the separate repository change.
