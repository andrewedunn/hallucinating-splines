# Website releases

The existing Cloudflare Pages project is a Direct Upload project. GitHub Actions
runs Wrangler against that project; no new Pages project or domain migration is
needed. The production site is https://hallucinatingsplines.com.

## Normal release

1. Open a PR. **Website checks** installs the locked site dependencies with Node
   22, runs TypeScript, replay tests, smoke-check regression tests and a production
   build. **Agent documentation checks** independently installs worker dependencies,
   reads the local OpenAPI schema, and checks generated references against sources.
   Both jobs must pass before deployment. PR jobs never receive Cloudflare credentials.
2. Merge to `main`. The workflow repeats the checks and stores the built site as
   an artifact containing `release.json` with the exact commit and site version.
3. The **Deploy website** job downloads that same artifact and deploys it with
   the lockfile's Wrangler version. Production jobs run one at a time; a queued
   commit superseded on main is skipped. Every main push triggers a run, including
   documentation changes, so a newer commit always has a replacement run.
4. The job verifies the public domain serves the expected commit/version and
   checks pages, canonicals, crawl files and CSS. Deployment is complete only when
   the full workflow is green.

`gh run list --workflow site-deploy.yml --branch main` shows deployment history.
Use `gh run view RUN_ID --log-failed` to diagnose a failed run. A failed verification
does not automatically revert production; check the reported failure first.

## Credential setup

GitHub's `production` environment permits only branch `main`. Set:

- Variable `CLOUDFLARE_ACCOUNT_ID`: the account hosting `hallucinating-splines-site`.
- Secret `CLOUDFLARE_API_TOKEN`: a dedicated Cloudflare token with **Account →
  Cloudflare Pages → Edit**, limited to that account. This permission applies to
  Pages projects in the selected account, not just one project. Do not use the
  personal Wrangler OAuth or refresh token.

Create the credential using Cloudflare's
[documented CI token process](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/),
then save it as an environment secret in GitHub. Never commit or paste the value
into an issue or chat. After rotating it, dispatch the workflow on `main` and wait
for production verification. If the token has an expiration, rotate it before
that date.

## Retry and rollback

To retry current main, run `gh workflow run site-deploy.yml --ref main`. The same
checks run again. A rerun of an older commit is skipped when main has moved.

For a code rollback, revert the problematic PR through a new PR and merge it;
the revert's workflow deploys and verifies that new commit. Emergency direct
Wrangler deployment is a fallback only: coordinate with running Actions jobs so
they cannot overwrite it, use a reviewed commit, and verify production afterward.

## Release scope

The workflow deploys the website only. It does not publish the API or MCP workers,
run migrations, create API keys or modify city records. Those releases remain
separate. Update `site/package.json` and its lockfile version when changing shared
styles, since that version is the browser cache key for the CSS URLs.
