# User Management Guide

## Quick Reference: Current Users

After running the reset script, these are your active users:

| Username | Password | Role | Permissions |
|----------|----------|------|-------------|
| `garage` | `garage123` | Main Admin | Full access - manage everything |
| `saadiyet` | `saadiyet123` | Stock Manager | Edit items & transfers only |
| `naji` | `naji123` | Viewer | Read-only access |

---

## How to Reset All Users

### On Your Local Machine (Linux)

Run from project root:
```bash
cd /home/mohamad-ghoush/Documents/QuantumLab/garage
bash scripts/reset-users-local.sh
```

This will:
1. ✓ Backup the current database
2. ✓ Remove all existing users
3. ✓ Clear all sessions
4. ✓ Create the 3 new users

**Then restart your app.**

### On VPS (Remote Server)

You need SSH access to the VPS:

```bash
# SSH into VPS
ssh user@your-vps-ip

# Navigate to project
cd /opt/garage-backend  # or wherever your backend is

# Copy and run the script
# (You need to upload scripts/reset-users.sh first)
bash reset-users.sh
```

**Important**: The VPS script uses `/var/lib/garage/garage.sqlite` as the database path by default. Adjust if yours is different.

---

## Manual Method (Without Scripts)

### Local Database

```bash
cd /home/mohamad-ghoush/Documents/QuantumLab/garage

# Backup first!
cp backend/data/garage.sqlite backend/data/garage.sqlite.backup

# Open database
sqlite3 backend/data/garage.sqlite

# Delete all users
DELETE FROM users;

# Delete all sessions
DELETE FROM sessions;

# Exit
.quit
```

Then run the app - it will create default users automatically.

### VPS Database

```bash
# SSH into VPS
ssh user@your-vps-ip

# Backup first!
sudo cp /var/lib/garage/garage.sqlite /var/lib/garage/garage.sqlite.backup

# Open database
sudo sqlite3 /var/lib/garage/garage.sqlite

# Delete all users
DELETE FROM users;

# Delete all sessions
DELETE FROM sessions;

# Restart the service
sudo systemctl restart garage-backend
```

---

## Creating Additional Users

### Via API (Recommended)

```bash
# 1. Get admin token
curl -X POST 'https://garage.quantumlab.codes/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"username":"garage","password":"garage123"}'

# 2. Create new user
curl -X POST 'https://garage.quantumlab.codes/api/users' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "username": "newuser",
    "password": "password123",
    "role": "viewer"
  }'
```

### Via Database (Direct)

```bash
# Generate password hash
echo -n "mypassword" | sha256sum

# Insert into database
sqlite3 backend/data/garage.sqlite "
INSERT INTO users (id, username, password_hash, role, enabled, is_main_admin, created_at, updated_at)
VALUES ('$(date +%s)000', 'newuser', 'HASH_FROM_ABOVE', 'viewer', 1, 0, $(date +%s)000, $(date +%s)000);
"
```

---

## User Roles Explained

### main_admin
- Full access to everything
- Can create/edit/delete all data
- Can manage users
- Can create device tokens
- Can view sync conflicts

**Use for**: Owners, managers, IT admins

### saadeyat_stock
- Can edit items and transfers
- Can view everything
- **Cannot** edit clients, cars, invoices, suppliers, employees, warehouses
- **Cannot** manage users

**Use for**: Stock managers, inventory staff

### viewer
- Read-only access to everything
- Cannot edit anything
- Cannot manage users

**Use for**: Accountants, viewing data, reports only

---

## Changing Passwords

### For Current User (via App)
1. Login to the app
2. Go to Settings (if available)
3. Change password

### For Any User (via API)
```bash
# As admin, get token first
curl -X POST 'https://garage.quantumlab.codes/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"username":"garage","password":"garage123"}'

# Update credentials
curl -X POST 'https://garage.quantumlab.codes/api/auth/update-credentials' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "currentUsername": "naji",
    "currentPassword": "naji123",
    "newPassword": "new_secure_password"
  }'
```

---

## Troubleshooting

### "Invalid credentials" after reset
- Make sure you restarted the app/backend
- Check you're using the correct new passwords
- Clear browser cache/cookies

### Script fails with "permission denied"
```bash
chmod +x scripts/reset-users-local.sh
bash scripts/reset-users-local.sh
```

### Can't login after running script
The app might have cached old sessions. Try:
1. Restart the backend
2. Clear browser localStorage
3. Try logging in again

### Need to restore from backup
```bash
# Find backup file
ls -la backend/data/*.backup*

# Restore (replace TIMESTAMP with actual backup file)
cp backend/data/garage.sqlite.backup.TIMESTAMP backend/data/garage.sqlite

# Restart app
```

---

## Security Best Practices

1. **Change default passwords immediately** after first login
2. **Use strong passwords** in production (not "password123")
3. **Limit admin accounts** - only give main_admin to trusted users
4. **Review users regularly** - disable accounts no longer needed
5. **Keep backups** before making changes

---

## Quick Commands Reference

```bash
# Reset users locally
bash scripts/reset-users-local.sh

# List current users (via API)
curl -X GET 'http://localhost:4000/api/users' \
  -H 'Authorization: Bearer YOUR_TOKEN'

# Backup database manually
cp backend/data/garage.sqlite backend/data/garage.sqlite.backup

# View users in database
sqlite3 backend/data/garage.sqlite "SELECT username, role, enabled FROM users;"
```

---

## Scripts Location

- **Local reset**: `scripts/reset-users-local.sh`
- **VPS reset**: `scripts/reset-users.sh` (upload to VPS)

Both scripts:
- ✓ Create automatic backups
- ✓ Remove all users
- ✓ Clear sessions
- ✓ Create the 3 default users

---

## Need Help?

- Check logs: Backend terminal or `sudo journalctl -u garage-backend -f`
- Database location:
  - Local: `backend/data/garage.sqlite`
  - VPS: `/var/lib/garage/garage.sqlite` (or check your `.env`)
- All scripts create backups automatically - you can always restore!
