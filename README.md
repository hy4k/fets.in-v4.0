# fets.in — v4.0

Static marketing site for FETS — Forun Testing & Educational Services
(authorized Prometric, Pearson VUE and PSI testing centre, Calicut & Kochi, Kerala).

Candidate support comes first: the landing screen is the **Ask FETS console** and nothing else
(pick an exam, tap a common question, or type one); the original site — facility, catalogue, centres, FAQ, contact — follows below it and is
reachable from the top bar and the Index.

The site itself is static (compiled React + Vite export plus hand-written support files): no build
step, no env vars. Typed questions are answered by the separate `fets-agent` service at `POST /ask`
(proxied by the host nginx); guided answers work without it.

## Structure

- `index.html` — support desk markup (static) + mount point for the compiled app
- `support.css`, `support.js` — support desk styling and behaviour (vanilla JS, no dependencies)
- `support/kb.json` — **the knowledge base**: every guided answer and official link. The page renders
  it directly and `fets-agent` loads the same file, so one edit updates both. Update `checked` and
  `version` when you re-verify an answer against the exam body's site.
- `assets/`, `images/` — the compiled app and media. There is no source for the compiled bundle;
  `assets/index-*-desk.js` is the original build with one nav entry added for the support desk.
- `enhancements.css`, `enhancements.js` — mobile polish and embedded maps
- `favicon.svg`, `robots.txt` — carried over / added at deploy time
- `Dockerfile` — nginx:alpine image serving the site
- `nginx.conf` — SPA fallback + 1-year immutable cache for static assets
- `compose.yml` — Traefik routing for Host(`fets.in`) with Let's Encrypt TLS

## Deploy (VPS srv1120621 — /opt/apps/fets-in)

```bash
ssh root@72.61.171.192
cd /opt/apps/fets-in
git pull
docker compose up -d --build
```

## Rollback

Previous version (v3 source + built webroot) is archived at
`/opt/apps/backups/fets-in-<date>.tar.gz` on the VPS.
