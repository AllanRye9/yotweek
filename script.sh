#!/usr/bin/env bash
set -euo pipefail
git pull origin main
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
cd ..
git add . && git commit -m "Update frontend build" && git push origin main
echo "✅ Done!"