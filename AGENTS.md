# Project instructions

Follow the project conventions and architecture in `CLAUDE.md`.

## Deploy Configuration
- Platform: Cloudflare Pages through GitHub Actions
- Production URL: https://hallucinatingsplines.com
- Deploy workflow: `.github/workflows/site-deploy.yml` (Website CI and deploy)
- Deploy status command: `gh run list --workflow site-deploy.yml --branch main --limit 5`
- Merge method: squash
- Project type: website with separate API and MCP workers
- Deploy trigger: push to `main`, after Website checks pass; manual workflow dispatch on `main` is also supported
- Post-deploy health check: `scripts/site-smoke.py` verifies the exact commit, version, public pages, agent documentation assets, crawl files and versioned CSS
- Credentials: production environment secret `CLOUDFLARE_API_TOKEN`, variable `CLOUDFLARE_ACCOUNT_ID`; production allows only branch `main`

This workflow deploys only `site/` to `hallucinating-splines-site`. API, MCP and D1
migrations remain separately released. Do not manually deploy Pages after a merge;
wait for the matching GitHub Actions run and its production verification. See
`docs/deployment.md` for setup, retries and rollback.
