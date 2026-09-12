# Deployment Guide

This guide covers deployment instructions for the VS Infra & Cranes web application.

## Required Environment Variables
The application requires the following environment variables (see `.env.example` for details):
- `PORT`
- `BASE_URL`
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASS`
- `SECRET_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `NOTIFICATION_EMAIL`
- `CORS_ORIGINS`

## Render
- Create a new Web Service.
- Connect your GitHub repository.
- Environment: Python
- Build Command: `pip install -r requirements.txt`
- Start Command: `python server.py` (or use the included `Procfile`)
- Add the required environment variables.

## AWS (EC2 / Elastic Beanstalk)
- For EC2, provision an instance with Python 3 installed, clone the repo, install requirements, and run `server.py` using `systemd` or `pm2`.
- For Elastic Beanstalk, use the Python platform. Ensure the entry point runs `server.py`.

## Hostinger VPS (systemd example)
Create a systemd service unit file (e.g., `/etc/systemd/system/vs-infra-cranes.service`):
```ini
[Unit]
Description=VS Infra & Cranes Web Service
After=network.target

[Service]
User=youruser
WorkingDirectory=/path/to/vs-infra-cranes
EnvironmentFile=/path/to/vs-infra-cranes/.env
ExecStart=/usr/bin/python3 server.py
Restart=always

[Install]
WantedBy=multi-user.target
```
Run `sudo systemctl daemon-reload` and `sudo systemctl start vs-infra-cranes.service`.

## Vercel
To deploy on Vercel, you will need a serverless adapter for Python (like `vercel-python`).
See Vercel's [Python documentation](https://vercel.com/docs/functions/serverless-functions/runtimes/python).

## Docker
A simple `Dockerfile`:
```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["python", "server.py"]
```

## MongoDB Atlas Network Access
Ensure that you whitelist the egress IP addresses of your deployment provider (Render, AWS, Hostinger, Vercel) in your MongoDB Atlas cluster network access settings. If the IPs are dynamic, you may need to allow access from anywhere (`0.0.0.0/0`) and rely on strong credentials.

## Health Check
The application provides a health check endpoint at `/api/health`. Use this endpoint to configure load balancers or uptime monitoring services.
