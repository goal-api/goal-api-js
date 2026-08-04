# Releasing

All five GOAL API SDKs share one version number, so `1.4.0` means the same surface in
every language. Bump this repo in step with the others.

```bash
# 1. Bump the version in `package.json`.
# 2. Add the CHANGELOG.md entry, then commit.
git commit -am "release 1.1.0"
git push

# 3. Tag it. The publish workflow refuses to run if the tag and the
#    committed version disagree.
git tag v1.1.0
git push --tags
```

To rehearse, run the `publish` workflow manually with `dry_run: true`: it builds,
validates and packs, then stops before uploading.

## One-time setup

### npm trusted publishing

1. Publish `1.0.0` once by hand; npm cannot configure trusted publishing for a package
   that does not exist. Provenance has to be off for this one, because signing it needs
   an OIDC token that only CI has:

   ```bash
   npm publish --access public --provenance=false
   ```

2. On npmjs.com go to the package, then Settings, then Trusted publishers, and add:
   - Repository: `goal-api/goal-api-js`
   - Workflow: `.github/workflows/publish.yml`
   - Environment: `npm`

After that there is no `NPM_TOKEN` to store or rotate.

## Package name

`@goalapi/sdk`, under the `goalapi` npm org. The scope is not `goal-api` — that one is
unclaimed and unrelated. The `User-Agent` the client sends is still `goal-api-js/<version>`,
which tracks the repo name rather than the registry name; leave it alone.

## Secrets

| Name | Environment | Needed for |
|---|---|---|
| `GOAL_API_KEY` | `live-api` | The live tests. They skip without it. |

No other secrets: npm uses OIDC.
