# VPS Access Guide - Giving Access to Users/Laptops

## Overview
Your VPS at `https://garage.quantumlab.codes` is the central sync server. This guide shows how to give access to:
1. **Laptops** (for syncing data)
2. **Other admins** (for managing the VPS)
3. **SSH users** (for server administration)

---

## Method 1: Give Laptop Access (Device Tokens)

This allows a laptop/desktop to sync with your VPS.

### Step 1: Login to VPS as Admin

From any computer with internet, get an admin token:

```bash
curl -X POST 'https://garage.quantumlab.codes/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"1234"}'
```

**Response:**
```json
{
  "token": "abc123...",
  "user": {...}
}
```

Copy the `token` value.

### Step 2: Create Device Token for the Laptop

```bash
curl -X POST 'https://garage.quantumlab.codes/api/admin/devices' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN_HERE' \
  -d '{"label":"Laptop-John"}'
```

Replace:
- `YOUR_ADMIN_TOKEN_HERE` with the token from Step 1
- `Laptop-John` with a descriptive name for this device

**Response:**
```json
{
  "deviceId": "abc123def456...",
  "deviceToken": "xyz789abc123..."
}
```

**Save the `deviceToken`** - you'll give this to the laptop user.

### Step 3: Configure the Laptop

On the laptop, create/edit `backend/.env`:

```env
SYNC_ROLE=client
DB_PATH=./data/garage.sqlite
SYNC_REMOTE_URL=https://garage.quantumlab.codes
SYNC_DEVICE_TOKEN=xyz789abc123...
SYNC_INTERVAL_MS=300000
CORS_ORIGIN=*
PORT=4000
```

Replace `xyz789abc123...` with the actual token from Step 2.

### Step 4: Start the Laptop App

On Windows:
```cmd
npm install
npm run electron:dev
```

On Linux/Mac:
```bash
npm install
npm run electron:dev
```

The laptop will now sync with your VPS automatically every 5 minutes!

---

## Method 2: Create App User Accounts

This creates login accounts for users to access the garage app.

### Option A: Via API (Recommended)

```bash
# First, get admin token (see Method 1, Step 1)

# Then create user
curl -X POST 'https://garage.quantumlab.codes/api/users' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -d '{
    "username": "john",
    "password": "secure_password_123",
    "role": "viewer"
  }'
```

**Roles:**
- `main_admin` - Full access (create users, manage everything)
- `saadeyat_stock` - Can edit items and transfers only
- `viewer` - Read-only access

### Option B: Via SSH on VPS

If you have SSH access to the VPS:

```bash
# SSH into VPS
ssh user@your-vps-ip

# Navigate to backend directory
cd /opt/garage-backend

# Use Node.js to add user directly
node -e "
const { createUser } = require('./src/db');
const user = createUser('john', 'secure_password_123', 'viewer');
console.log('User created:', user);
"
```

---

## Method 3: Give SSH Access to VPS (Server Administration)

### For Linux Admins:

#### Step 1: Create SSH Key (on their computer)
```bash
ssh-keygen -t ed25519 -C "john@company.com"
```

They should send you the **public key** (`.pub` file).

#### Step 2: Add Their Public Key to VPS
```bash
# SSH into your VPS
ssh root@your-vps-ip

# Create user (if doesn't exist)
sudo adduser john

# Add to sudo group (optional, for admin access)
sudo usermod -aG sudo john

# Add their SSH key
sudo mkdir -p /home/john/.ssh
sudo nano /home/john/.ssh/authorized_keys
# Paste their public key here, save and exit

# Set permissions
sudo chmod 700 /home/john/.ssh
sudo chmod 600 /home/john/.ssh/authorized_keys
sudo chown -R john:john /home/john/.ssh
```

#### Step 3: They Can Now SSH
```bash
ssh john@your-vps-ip
```

### For Windows Admins:

Use **PuTTY** or **Windows Terminal** with SSH:

```powershell
ssh john@your-vps-ip
```

---

## Method 4: Revoke Access

### Revoke Device Token (Laptop Access)

```bash
# Get admin token first
curl -X POST 'https://garage.quantumlab.codes/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"1234"}'

# Revoke device
curl -X POST 'https://garage.quantumlab.codes/api/admin/devices/revoke' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -d '{"deviceId":"DEVICE_ID_HERE"}'
```

The laptop will no longer be able to sync.

### Disable User Account

Via SQLite on VPS:
```bash
ssh user@your-vps-ip
cd /opt/garage-backend
sqlite3 /var/lib/garage/garage.sqlite

UPDATE users SET enabled = 0 WHERE username = 'john';
.quit
```

### Remove SSH Access

```bash
ssh root@your-vps-ip
sudo userdel -r john  # Removes user and home directory
```

---

## Quick Reference Table

| Access Type | Who Needs It | How to Give |
|-------------|--------------|-------------|
| **Laptop Sync** | Remote workers with laptops | Create device token (Method 1) |
| **App Login** | Users who need to login | Create user account (Method 2) |
| **SSH Access** | Server admins | Add SSH key (Method 3) |
| **Admin Rights** | Trusted admins | Set role to `main_admin` |

---

## Security Best Practices

1. **Device Tokens**: Create one per laptop, label them clearly
2. **Passwords**: Use strong passwords for user accounts
3. **SSH Keys**: Always use SSH keys, never password-only SSH
4. **Firewall**: Only allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS)
5. **Backups**: Run daily backups (see `deploy/backup/backup-garage-sqlite.sh`)
6. **Monitoring**: Check logs regularly:
   ```bash
   sudo journalctl -u garage-backend -f
   ```

---

## Troubleshooting

### "Invalid credentials" when creating device token
- Make sure you're using a valid admin token
- Token expires - get a fresh one

### Laptop won't sync
- Check `SYNC_DEVICE_TOKEN` in `backend/.env`
- Check internet connection
- Check VPS is running: `sudo systemctl status garage-backend`

### SSH connection refused
- Check VPS firewall allows port 22
- Verify SSH service running: `sudo systemctl status ssh`

---

## Current VPS Configuration

Your current setup:
- **VPS URL**: `https://garage.quantumlab.codes`
- **Your laptop**: Already configured with device token
- **Role**: Client (syncs TO the VPS)

To give access to someone else, use **Method 1** (create device token) and send them the token.

---

## Example: Complete Laptop Setup for New User

**On your computer (admin):**
```bash
# 1. Get admin token
curl -X POST 'https://garage.quantumlab.codes/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"1234"}'

# 2. Create device token
curl -X POST 'https://garage.quantumlab.codes/api/admin/devices' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN_FROM_STEP_1>' \
  -d '{"label":"New-User-Laptop"}'

# 3. Send them the deviceToken and these instructions
```

**Send to new user:**
```
1. Install Node.js from nodejs.org
2. Clone the repo or download the code
3. Create backend/.env with:
   SYNC_ROLE=client
   SYNC_REMOTE_URL=https://garage.quantumlab.codes
   SYNC_DEVICE_TOKEN=<THE_TOKEN_I_GAVE_YOU>
   SYNC_INTERVAL_MS=300000
   PORT=4000
4. Run: npm install
5. Run: npm run electron:dev
6. Login with: admin / 1234
```

Done! 🎉
