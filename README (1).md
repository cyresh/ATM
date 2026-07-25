# Auditor Task Manager

Offline task manager PWA. These files are meant to sit directly in the **root**
of your GitHub repo — not inside a subfolder — so GitHub Pages can serve
`index.html` straight from `/`.

## Files
- `index.html` — app shell/UI
- `app.js` — app logic
- `db.js` — local data layer (localStorage-based, offline-safe)
- `manifest.json` — PWA manifest (enables "Install"/"Add to Home Screen")
- `sw.js` — service worker (offline caching)
- `icon-192.png`, `icon-512.png` — app icons

## Hosting on GitHub Pages

1. Create a new repo (or use an existing one).
2. Upload these 7 files to the **root** of the repo — same level as where
   your repo's own README would go, not inside a folder.
3. In the repo: **Settings → Pages → Source**, choose the branch (usually
   `main`) and folder `/ (root)`, then Save.
4. GitHub gives you a URL like `https://<username>.github.io/<repo-name>/`.
   Open that on your phone — you'll get the "Install" / "Add to Home
   Screen" prompt since it's served over HTTPS with a valid manifest and
   service worker.

## Notes
- All paths in `index.html` are relative (`app.js`, `db.js`, `manifest.json`,
  icons) — they only resolve correctly if the files stay flat, at the same
  folder level as `index.html`. Don't move `app.js`/`db.js` into a
  subfolder without updating the `<script src="...">` paths to match.
- Every visit re-fetches `sw.js`'s cache list, so after pushing an update,
  bump `CACHE_NAME` in `sw.js` (e.g. `atm-cache-v2`) so returning users get
  the new version instead of a stale cached one.
- All data lives in the browser's local storage on each device — nothing
  is synced between devices or sent to any server.
