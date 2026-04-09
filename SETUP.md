# The Chronicler — Setup Guide (Generic)

This guide is for self-hosting The Chronicler on **any** machine (bare metal, VM, VPS, NAS, etc.). It does **not** assume Proxmox or any specific hypervisor.

## Requirements

- A machine that can run Docker (Linux recommended)
- Docker + Docker Compose plugin
- 2GB RAM minimum (4GB recommended for faster builds)
- A place for persistent storage (Docker volume by default)

## Install Docker (Linux)

If you already have Docker installed, skip this section.

On Ubuntu/Debian, the quickest path is:

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
exit
```

Log back in, then verify:

```bash
docker --version
docker compose version
```

## Get the code

On the server/machine where you’ll run it:

```bash
git clone https://github.com/EAJ-97/The-Chronicler.git notesapp
cd notesapp
```

## First run (Docker)

Build and start:

```bash
docker compose up -d --build
docker compose logs -f
```

Open the app:

- Local machine: `http://localhost:3001`
- Remote server: `http://YOUR_SERVER_IP:3001`

### First user becomes admin

On first boot, register an account in the UI. The **first registered user becomes admin** automatically.

## Secrets and persistence

- The app stores data under `/data` inside the container (SQLite DB, uploads, etc.), backed by a Docker volume.
- On first boot, the container auto-generates and persists:
  - `JWT_SECRET` (saved to `/data/.jwt_secret`)
  - `ADMIN_RECOVERY_TOKEN` (saved to `/data/.admin_recovery_token`)

If you want to set your own fixed values, supply environment variables in your container runtime configuration.

## Updating

```bash
cd notesapp
git pull origin main
docker compose up -d --build
docker compose logs -f
```

## Backups

Recommended: use the in-app backup/export features (Admin → Backup, and DM exports).

If you need a raw file copy of the SQLite database, do it from inside the running container so you capture the correct `/data` location:

```bash
docker compose exec chronicler sh -lc 'ls -la /data'
```

Then use Admin → Backup to download a sanitized DB copy.

## Exposing it on the internet (optional)

If you want remote access, put it behind **one** of these:

- A reverse proxy you control (Nginx/Caddy/Traefik) with HTTPS
- A tunnel solution (Cloudflare Tunnel, Tailscale Funnel, etc.)

Keep the default port 3001 closed to the public internet unless you know what you’re doing.

## Troubleshooting

- **Can’t reach the app**
  - Check containers: `docker compose ps`
  - Check logs: `docker compose logs --tail=200`
  - Check firewall allows port 3001 (only on your LAN if not using a proxy/tunnel)

- **Everyone gets logged out**
  - If the `/data` volume was wiped, a new `JWT_SECRET` is generated and old sessions become invalid.

- **Graph looks empty**
  - Create at least two notes and add a connection, then open the Web view.
