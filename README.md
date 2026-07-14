# lead-dialer-shared

Auto-update source for the shared (coworker) Lead Dialer install. **Not the app itself** — this repo just holds the two files that change (`server.js`, `public/index.html`) plus a `VERSION` marker, which `Start Lead Dialer.command` checks and pulls from on every launch.

No AI features, no Supabase/cloud sync — this is the stripped-down, local-only version. See the personal-copy CLAUDE.md for the full resync process.

To ship an update: bump `VERSION`, push the updated `server.js`/`public/index.html`, done — every coworker's app self-updates on next launch.
