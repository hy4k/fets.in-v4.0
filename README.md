# fets.in — v4.0

Static marketing site for FETS — Forun Testing & Educational Services
(authorized Prometric, Pearson VUE and PSI testing centre, Calicut & Kochi, Kerala).

Pure static build (React + Vite export): no backend, no Supabase, no env vars required.

## Structure

- `index.html`, `assets/`, `images/` — the static site
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
