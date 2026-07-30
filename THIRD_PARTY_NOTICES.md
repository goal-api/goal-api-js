# Third-party notices

This package is MIT licensed and has **no runtime dependencies**. It uses the platform's
own `fetch`, `WebSocket` and `node:crypto`, so `npm install @goal-api/sdk` adds exactly one
package to your tree.

## Optional peer dependency

| Package | Licence | When |
|---|---|---|
| [ws](https://github.com/websockets/ws) | MIT | Only on Node 18-21, where there is no global `WebSocket`. Declared as an optional peer dependency, so npm never installs it for you. Node 22+ and browsers need nothing. |

## Development only

Not installed for consumers and not in the published tarball: `typescript` (Apache-2.0) and
`@types/node` (MIT), both pulled ad hoc in CI to typecheck the declarations.

## Checking this yourself

```bash
npm ls --omit=dev --all      # empty
npm pack --dry-run           # what actually ships
```
