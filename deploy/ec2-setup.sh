#!/bin/bash
# One-time setup for Harness API on EC2 (52.45.218.243)
# Run as ec2-user with sudo access.
set -euo pipefail

echo "=== Setting up Harness API directories ==="
sudo mkdir -p /opt/harness-api /opt/harness-api-staging
sudo chown ec2-user:ec2-user /opt/harness-api /opt/harness-api-staging

echo "=== Installing Python 3.11 ==="
if ! command -v python3.11 &>/dev/null; then
    sudo yum install -y python3.11 python3.11-pip
fi

echo "=== Creating virtual environments ==="
python3.11 -m venv /opt/harness-api/.venv
python3.11 -m venv /opt/harness-api-staging/.venv

echo "=== Installing systemd services ==="
sudo cp "$(dirname "$0")/harness-api.service" /etc/systemd/system/
sudo cp "$(dirname "$0")/harness-api-staging.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable harness-api harness-api-staging

echo "=== Done ==="
echo "Next steps:"
echo "  1. Create /opt/harness-api/.env and /opt/harness-api-staging/.env"
echo "  2. Deploy code via CI/CD or rsync"
echo "  3. sudo systemctl start harness-api harness-api-staging"
