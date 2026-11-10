# Packaging and releases

Mastery ships as a desktop app for macOS and Windows. The app is the same server and web
interface as `pnpm dev`, wrapped in an Electron shell (`apps/desktop`). Nothing about the product
lives in the shell: grading, building and the library are the server's; the interface is the
web app's. The shell only decides where things run and where they are stored.

## What the shell does

- Starts the server in the app's own process on `127.0.0.1` at a port the OS picks, so it never
  collides with anything else on the machine.
- Mints a random token at launch and attaches it to its window's requests. The server rejects any
  `/api` call without it, so a web page open in a browser tab cannot drive your local server.
- Points the server at the OS's per-user application folder:
  - macOS: `~/Library/Application Support/Mastery/`
  - Windows: `%APPDATA%\Mastery\`
  - `data/` holds the library, courses, sessions and the encrypted key vault; `prompts/` holds
    the prompts (seeded from the bundle on first run, then yours to edit from Settings);
    `logs/mastery.log` holds the server log. Help → "Show my data folder" opens it.
- Opens external links in the default browser and keeps the window on the local server.
- Checks GitHub Releases for a newer version on launch (signed builds only; see below).

## Build locally

```bash
pnpm install
pnpm desktop:dev          # bundle, then launch the unpackaged app
pnpm desktop:dist         # installers for the current OS into apps/desktop/release/
pnpm --filter @mastery/desktop dist:win   # the Windows installer can be built on a Mac
```

`apps/desktop/scripts/build.mjs` bundles the server into one self-contained ESM file and the
main process into one CommonJS file (esbuild), then stages the web build and the prompts under
`apps/desktop/resources/`. electron-builder packs those as extra resources, so the installer
carries no `node_modules` and no native modules. The web build is served by `static.ts`, which
resolves against an absolute directory because the working directory of a Finder-launched app
is arbitrary.

Smoke test without clicking: `MASTERY_SMOKE=release/smoke.png electron .` from `apps/desktop`
starts the app, waits for the first screen, writes a screenshot and quits.

## Release

1. Bump `"version"` in `apps/desktop/package.json` (electron-builder refuses a tag that does not
   match it).
2. Commit, tag and push:
   ```bash
   git tag v0.1.0 && git push origin main v0.1.0
   ```
3. `.github/workflows/release.yml` builds on macOS (arm64 and x64 DMG and zip) and Windows (x64
   NSIS installer) and publishes the artifacts, plus the `latest*.yml` manifests the updater reads,
   to a GitHub Release named after the tag.
4. The download page at `site/index.html` (deployed to GitHub Pages by `pages.yml`) reads the
   latest release and offers the right installer for the visitor's OS.

One-time setup on GitHub: create the repository, push `main`, and under Settings → Pages set the
source to "GitHub Actions". `publish.owner`/`repo` in `apps/desktop/electron-builder.yml`, the
`REPO` constant in `site/index.html` and the two links in `apps/desktop/src/menu.ts` all name
the repository; change them together if it moves.

## Signing

Unsigned builds work but make a poor first impression, and macOS blocks their auto-update:

- macOS shows "cannot be checked for malicious software"; the user right-clicks → Open once.
  Signed and notarized builds open normally and self-update.
- Windows SmartScreen shows "unrecognized app"; the user clicks More info → Run anyway. Signed
  builds with an EV certificate skip this immediately, OV certificates after reputation builds.

To sign, add these repository secrets and the same workflow produces signed builds:

| Secret | What it is |
| --- | --- |
| `MAC_CERT_P12`, `MAC_CERT_PASSWORD` | Developer ID Application certificate, base64 of the .p12, and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization credentials (Apple Developer Program, US$99/yr) |
| `WIN_CERT_PFX`, `WIN_CERT_PASSWORD` | Authenticode certificate, base64 of the .pfx, and its password |

The hardened-runtime entitlements Chromium needs are in `apps/desktop/build/entitlements.mac.plist`.

## Managed key

The desktop build is bring-your-own-key. A managed key means a server you run that holds the
key and bills the user, with the app calling it instead of Anthropic directly; the server side of
that (`MASTERY_MANAGED_KEY`) exists, the billing and accounts do not. Until then, Settings offers
"your key" only in the packaged app unless `MASTERY_MANAGED_KEY` is set in its environment.
