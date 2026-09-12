# Deployment Guide — VS Infra & Cranes (Node.js / Express)

This guide covers deployment instructions for the VS Infra & Cranes production Node.js application.

## Required Environment Variables
Configure the following environment variables (see `.env.example` for details):
- `PORT` (e.g. `8080` or platform-provided)
- `HOST` (`0.0.0.0`)
- `BASE_URL` (e.g. `https://vsinfracranes.com` or `https://your-service.onrender.com`)
- `MONGODB_URI` (`mongodb+srv://...`)
- `MONGODB_DB_NAME` (`vs_infra_cranes`)
- `ADMIN_EMAIL` (`vsinfracranes@gmail.com`)
- `ADMIN_PASS` (Secure password)
- `SECRET_KEY` (Random 64-char hex string)
- `SMTP_HOST` (`smtp.gmail.com`)
- `SMTP_PORT` (`587`)
- `SMTP_USER` (Your Gmail/SMTP address)
- `SMTP_PASS` (Gmail App Password)
- `NOTIFICATION_EMAIL` (`vsinfracranes@gmail.com`)
- `CORS_ORIGINS` (Comma-separated allowed origins)

---

## Render Deployment
1. Create a new **Web Service** on Render.
2. Connect your GitHub repository (`main` branch).
3. **Runtime**: `Node`
4. **Build Command**: `npm install --production`
5. **Start Command**: `node server.js` (or use the included `Procfile`)
6. Add the environment variables under **Environment**.
7. In MongoDB Atlas, ensure Network Access allows the connection (add `0.0.0.0/0` for Render dynamic outbound IPs).

---

## Hostinger Cloud / VPS (Node.js)
1. Ensure Node.js 18+ LTS is installed on your VPS (`node -v`).
2. Clone repository: `git clone https://github.com/vinityadav27/vs-infra-cranes.git`.
3. Install production dependencies: `npm install --production`.
4. Copy `.env.example` to `.env` and configure values: `cp .env.example .env`.
5. Use PM2 or systemd to daemonize:
   ```bash
   pm2 start server.js --name vs-infra-cranes
   pm2 save
   pm2 startup
   ```
   Or create `/etc/systemd/system/vs-infra-cranes.service`:
   ```ini
   [Unit]
   Description=VS Infra & Cranes Node.js Web Service
   After=network.target

   [Service]
   User=youruser
   WorkingDirectory=/path/to/vs-infra-cranes
   EnvironmentFile=/path/to/vs-infra-cranes/.env
   ExecStart=/usr/bin/node server.js
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
6. Reload and start: `sudo systemctl daemon-reload && sudo systemctl start vs-infra-cranes`.

---

## Docker Deployment
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8080
ENV PORT=8080
ENV HOST=0.0.0.0
CMD ["node", "server.js"]
```

---

## Health Check
Endpoint: `GET /api/health` returns `200 OK` with JSON status. Use this endpoint for load balancer health probes and uptime monitoring.
