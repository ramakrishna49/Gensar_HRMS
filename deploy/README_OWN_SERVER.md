# Own-server deploy (VPS) — Gensar HRMS + Android app backend

## 1. VPS prep (Ubuntu 24.04, 4GB RAM)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
git clone <your-fork-url> && cd Gensar_HRMS
```

## 2. Env
```bash
cp .env.example .env.production
# Fill: DB_PASSWORD (compose), DATABASE_URL is auto-set for `api` service,
# JWT_SECRET, JWT_REFRESH_SECRET, ALLOWED_ORIGINS=https://yourdomain,
# LOCAL_STORAGE_DIR=/app/uploads, APP_URL, MIN_APP_VERSION=1.0.0,
# LATEST_APP_VERSION=1.0.0, PLAY_STORE_URL, FCM_SERVICE_ACCOUNT_JSON (Phase-2)
nano .env.production
export DB_PASSWORD='<strong-password>'
```

## 3. Run
```bash
docker compose up -d --build
docker compose logs -f api
# health: curl https://api.yourdomain/api/mobile/app-config
```

## 4. HTTPS (Let's Encrypt)
```bash
sudo apt install -y certbot
sudo mkdir -p certbot/www certbot/conf
sudo certbot certonly --webroot -w ./certbot/www -d api.yourdomain
# uncomment 443 block in deploy/nginx.conf, then:
docker compose up -d nginx
# cron renew: 0 3 * * * certbot renew --quiet && docker compose restart nginx
```

## 5. Backups (daily cron on host)
```bash
docker compose exec db pg_dump -U gensar gensar_hrms | gzip > backup-$(date +%F).sql.gz
# + copy ./uploads (or uploads volume) to S3/offsite
```

## 6. Android app wiring
- `flutter-app/lib/core/config.dart` lo `apiBaseUrl = https://api.yourdomain`
- Login API: `POST /api/auth/login` -> returns `token` + `refresh_token`
- Refresh: `POST /api/auth/refresh` with `{"refresh_token": "..."}`
- Device: `POST /api/mobile/register-device` (after login, with FCM token)
- Version gate: `GET /api/mobile/app-config` at app start
