# Vercel deployment fix

This version replaces internal build-environment registry URLs in `package-lock.json` with public `registry.npmjs.org` URLs.

It also pins Vercel to Node.js 22.x via `package.json` and adds `.npmrc` to use the public npm registry.

No application source code has changed.
