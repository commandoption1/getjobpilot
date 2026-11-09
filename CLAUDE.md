# JobPilot

Self-hosted, single-user job search dashboard: Astro 7 + Vue islands on Cloudflare Workers with D1. See README.md and docs/.

- Keep it a clean template: no personal names, emails, domains, Access ids or database ids in code, docs or tests.
  Use `examples/` and placeholders; real values belong in the user's own D1 data, secrets and `wrangler.jsonc`.
- Every feature must keep a free path (Workers Free, no Claude key). Document anything that needs a paid plan.
- Before pushing: `npm test`, `npm run typecheck`, `npm run build` (CI runs the same).
- `src/core/` must stay free of Cloudflare and network imports so it can be tested and reused by the extension.
- Never weaken `checkResume` (src/core/resume.ts) or the style rules to make a draft pass; the point is that nothing
  invented reaches a resume. Company, title and dates always come from the profile by id.
- The extension never submits a form. Keep it that way.
