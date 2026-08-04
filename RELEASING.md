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

1. Publish `1.0.0` once by hand (`npm publish --access public`); npm cannot configure
   trusted publishing for a package that does not exist.
2. On npmjs.com go to the package, then Settings, then Trusted publishers, and add:
   - Repository: `goal-api/goal-api-js`
   - Workflow: `.github/workflows/publish.yml`
   - Environment: `npm`

After that there is no `NPM_TOKEN` to store or rotate.

## Package name

> The registry name in this repo is a placeholder pending confirmation. Check you own the
> namespace before the first publish; renaming after release is disruptive.

## Secrets

| Name | Environment | Needed for |
|---|---|---|
| `GOAL_API_KEY` | `live-api` | The live tests. They skip without it. |

No other secrets: npm uses OIDC.
