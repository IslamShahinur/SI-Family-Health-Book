# SI Family Health Book

A private family health-records app. Photos and PDFs of prescriptions, lab reports and other papers are stored in Google Drive, indexed in a Google Sheet, and opened through a phone app (PWA).

## Structure

| Folder | Purpose |
|---|---|
| `apps-script/` | Google Apps Script backend + web UI (`Code.js`, `Index.html`, `JavaScript.html`, `appsscript.json`) |
| `pwa/` | Installable home-screen wrapper (static files) that opens the Apps Script web app |
| `docs/` | Specification, user and developer guide |

## Setup

1. Create an Apps Script project and copy the files from `apps-script/` into it (or use [clasp](https://github.com/google/clasp): `cd apps-script && clasp create` then `clasp push`).
2. Deploy as a **Web app** and copy the `/exec` link.
3. In `pwa/index.html`, replace `YOUR_DEPLOYMENT_ID` with your deployment ID.
4. Host `pwa/` on any static host (e.g. GitHub Pages) and add it to the phone home screen.

See `docs/User-and-Developer-Guide.md` for full details.

## Privacy

No credentials are stored in this repo. The deployment link is a placeholder; keep your real link out of commits.
