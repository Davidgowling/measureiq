# MeasureIQ (cloud login + sync)

This repo now includes a lightweight Node/Express backend so MeasureIQ can:
- let users **register/login** (email + password)
- **store customers / rooms / accessories / business profile** in a database
- access the same data on **any device**

## Quick start (local)

### 1) Install server dependencies

```bash
cd server
npm install
```

### 2) Run the app

```bash
npm start
```

Then open:
- http://localhost:3000

## Where data is stored

By default the server uses SQLite:
- `server/data/measureiq.db`

## Environment variables

Copy the example env:

```bash
cd server
cp .env.example .env
```

Set `JWT_SECRET` before any real deployment.

## Cloud vs local mode

- If you **don’t sign in**, MeasureIQ keeps using browser `localStorage` (your current behaviour).
- When you **sign in**, it switches to **cloud sync**.

On first registration, MeasureIQ will attempt to push any existing local data to the cloud.

## API (for reference)

- `POST /api/auth/register` { email, password }
- `POST /api/auth/login` { email, password }
- `GET /api/me`
- `GET/PUT /api/settings/business-profile`
- `GET/PUT /api/settings/accessories`
- `GET /api/customers`
- `POST /api/customers/upsert`
- `DELETE /api/customers/:name`
