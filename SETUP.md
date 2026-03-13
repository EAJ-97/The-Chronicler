# The Chronicler — Setup Guide

A DnD party notes app with spiderweb graph view, per-user accounts, shared notes, and markdown editing.

---

## PART 1: Create the VM on Proxmox

1. Log into your Proxmox web UI (usually https://YOUR-SERVER-IP:8006)

2. Click **Create VM** (top right)

3. Fill in these settings:
   - **General**: Give it a name like `chronicler`
   - **OS**: Upload or select an Ubuntu 24.04 LTS ISO
     (Download from https://ubuntu.com/download/server)
   - **System**: Leave defaults
   - **Disks**: 20GB is plenty
   - **CPU**: 2 cores
   - **Memory**: 2048 MB (2GB)
   - **Network**: Leave default (uses Proxmox bridge)

4. Click **Finish**, then **Start** the VM

5. Click **Console** to open the VM screen and follow the Ubuntu installer:
   - Choose "Install Ubuntu Server"
   - Pick your language/keyboard
   - For network: DHCP is fine to start
   - Create a user account (e.g., username: `dnd`, password: whatever you want)
   - Enable "Install OpenSSH server" when asked ← important!
   - Let it install and reboot

---

## PART 2: Set a Static IP on the VM

This makes sure the VM always gets the same IP on your network.

1. In Proxmox console, log in to Ubuntu, then run:
   ```bash
   ip addr
   ```
   Note the current IP (something like 192.168.1.x) and the interface name (like `ens18`)

2. Edit the network config:
   ```bash
   sudo nano /etc/netplan/00-installer-config.yaml
   ```

3. Replace the contents with (adjust IP/gateway for your network):
   ```yaml
   network:
     version: 2
     ethernets:
       ens18:
         dhcp4: false
         addresses: [192.168.1.50/24]
         gateway4: 192.168.1.1
         nameservers:
           addresses: [1.1.1.1, 8.8.8.8]
   ```
   (Change `ens18` to your interface name, and the IPs to match your network)

4. Apply it:
   ```bash
   sudo netplan apply
   ```

Now you can SSH from your Windows PC: `ssh dnd@192.168.1.50`

---

## PART 3: Install Docker on the VM

SSH into the VM from Windows (use PuTTY or Windows Terminal):
```bash
ssh dnd@192.168.1.50
```

Then run these commands one by one:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh

# Add your user to the docker group (so you don't need sudo)
sudo usermod -aG docker $USER

# Log out and back in for the group change to take effect
exit
```

SSH back in, then verify:
```bash
docker --version
docker compose version
```

---

## PART 4: Deploy The Chronicler

1. Copy the project files to your VM. From your Windows PC, open a terminal in
   the project folder (e.g. `notesapp` or `dnd-chronicler`) and run:
   ```bash
   scp -r . dnd@192.168.1.50:~/notesapp
   ```

2. SSH back into the VM:
   ```bash
   ssh dnd@192.168.1.50
   cd ~/notesapp
   ```

3. **Optional:** A `JWT_SECRET` is auto-generated on first boot and saved to the data volume. To use a fixed secret instead, add `JWT_SECRET` to the `environment` section of `docker-compose.yml` or set it in a `.env` file.

4. Build and start the app:
   ```bash
   docker compose up -d --build
   ```
   This takes a few minutes the first time (downloading Node.js, installing packages, building).

5. Check it's running:
   ```bash
   docker compose logs -f
   ```
   You should see: `DnD Notes server running on port 3001`

6. Open a browser on your PC and go to: `http://192.168.1.50:3001`
   You should see the login page!

---

## PART 5: Set Up Cloudflare Tunnel (access from anywhere)

This lets you reach the app from your phone or anywhere on the internet,
securely, without opening any router ports.

### Prerequisites
- A domain name managed by Cloudflare (even a cheap one works, ~$10/year)
- A free Cloudflare account

### Steps

1. In the Cloudflare dashboard, go to **Zero Trust** → **Networks** → **Tunnels**

2. Click **Create a tunnel**, name it `chronicler`

3. Choose **Docker** as the connector type. Cloudflare gives you a command like:
   ```
   docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token YOUR_TOKEN_HERE
   ```

4. Add this to your `docker-compose.yml` as a second service:
   ```yaml
   services:
     chronicler:
       # ... existing config ...

     cloudflared:
       image: cloudflare/cloudflared:latest
       restart: unless-stopped
       command: tunnel --no-autoupdate run --token YOUR_TOKEN_HERE
       depends_on:
         - chronicler
   ```

5. In the Cloudflare tunnel config, add a Public Hostname:
   - **Subdomain**: `notes` (or whatever you want)
   - **Domain**: your domain (e.g., `yourname.com`)
   - **Service**: `http://chronicler:3001`

6. Restart:
   ```bash
   docker compose up -d
   ```

7. Your app is now live at `https://notes.yourname.com` 🎉

---

## Maintenance Commands

```bash
# View logs
docker compose logs -f

# Stop the app
docker compose down

# Rebuild and restart (e.g. after updating)
docker compose up -d --build

# Backup your database
docker compose exec chronicler cat /data/dnd_notes.db > backup.db
```

---

## Troubleshooting

**Can't reach the app from browser:**
- Check the VM IP: `ip addr`
- Check the container is running: `docker compose ps`
- Check firewall: `sudo ufw allow 3001`

**Login not working:**
- If you use a custom JWT_SECRET, ensure it is set in the environment or `.env`. Otherwise the app auto-generates one on first boot (stored in the data volume).

**Graph view is empty:**
- You need to create at least 2 notes and connect them first
- Use the "Link another note..." field at the bottom of the editor
