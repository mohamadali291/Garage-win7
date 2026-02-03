#!/bin/bash
# Script to reset all users and create fresh ones
# This must be run on the VPS server with SSH access

set -e

# Database path (adjust if needed)
DB_PATH="${DB_PATH:-/var/lib/garage/garage.sqlite}"

echo "==================================="
echo "User Reset Script for Garage VPS"
echo "==================================="
echo ""
echo "Database: $DB_PATH"
echo ""

# Backup current database
BACKUP_FILE="${DB_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
echo "Creating backup: $BACKUP_FILE"
cp "$DB_PATH" "$BACKUP_FILE"
echo "✓ Backup created"
echo ""

# Delete all users
echo "Removing all existing users..."
sqlite3 "$DB_PATH" "DELETE FROM users;"
echo "✓ All users removed"
echo ""

# Delete all sessions
echo "Clearing all sessions..."
sqlite3 "$DB_PATH" "DELETE FROM sessions;"
echo "✓ Sessions cleared"
echo ""

# Create new users
echo "Creating new users..."

# Function to create user
create_user() {
  local username=$1
  local password=$2
  local role=$3
  local is_admin=$4
  
  # Generate hash for password
  local hash=$(echo -n "$password" | sha256sum | cut -d' ' -f1)
  local id=$(date +%s%N | cut -b1-13)
  local now=$(date +%s)000
  
  sqlite3 "$DB_PATH" "INSERT INTO users (id, username, password_hash, role, enabled, is_main_admin, created_at, updated_at) VALUES ('$id', '$username', '$hash', '$role', 1, $is_admin, $now, $now);"
  
  echo "  ✓ Created: $username ($role)"
}

# Create the three users
create_user "garage" "garage123" "main_admin" 1
create_user "saadiyet" "saadiyet123" "saadeyat_stock" 0
create_user "naji" "naji123" "viewer" 0

echo ""
echo "==================================="
echo "✓ User reset complete!"
echo "==================================="
echo ""
echo "New user credentials:"
echo "  1. garage / garage123 (Admin)"
echo "  2. saadiyet / saadiyet123 (Stock Manager)"
echo "  3. naji / naji123 (Viewer)"
echo ""
echo "Backup saved at: $BACKUP_FILE"
echo ""
