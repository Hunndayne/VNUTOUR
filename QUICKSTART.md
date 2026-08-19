# Quick Start Guide - Running VNUTour Web

## Prerequisites ✓
- Python 3.14.3 ✓
- Node.js 24.14.1 ✓  
- npm 11.11.0 ✓
- Docker 29.7.2 ✓
- Dependencies already installed ✓

## Step 1: Start PostgreSQL Database
The database is already running! ✓

To verify it's running:
```powershell
docker ps | findstr "vnutour-dev-postgres"
```

## Step 2: Run Database Migrations
In PowerShell at `backend/` folder:
```powershell
.venv\Scripts\python.exe webapi/manage.py migrate --noinput
```

## Step 3: Start Backend Server
In PowerShell at `backend/` folder:
```powershell
.venv\Scripts\python.exe main.py
```

This starts:
- Django REST API on http://localhost:8000
- Discord bot (if token configured in .env)

## Step 4: Start Frontend Dev Server
In a NEW PowerShell at `frontend/` folder:
```powershell
npm run dev
```

This starts:
- React dev server on http://localhost:5173

## All Running! 
Once both are running:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/api

## Troubleshooting

**Database connection error?**
```powershell
docker logs vnutour-dev-postgres-1
```

**Need to stop database?**
```powershell
docker compose -f docker-compose.dev.yml --env-file .env.dev down
```

**Reset database?**
```powershell
docker compose -f docker-compose.dev.yml --env-file .env.dev down -v
docker compose -f docker-compose.dev.yml --env-file .env.dev up postgres -d
.venv\Scripts\python.exe webapi/manage.py migrate --noinput
```
