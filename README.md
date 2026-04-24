# Expense & Accounts Manager

Professional full-stack web app for expense/account tracking with category management, authentication, and visual analytics.

## Features

- Add, edit, delete expenses with:
  - Date
  - Category dropdown
  - Description
  - Amount and currency selection
- Add, edit, delete categories
- User authentication:
  - Create account
  - Login / logout
  - Change password
  - Forgot password / reset password
  - Separate data per user account
- Monthly stat cards with total expenditure
- Visual charts:
  - Spending by month
  - Spending by category
- JSON-backed persistence (`data/db.json`)
- Includes `OMR` (Omani Rial) in currency options

## Run

```bash
cd /Users/prithviraj/development/expense-accounting-app
npm start
```

Open: `http://localhost:3000`

## Share With Another Laptop (Same Wi-Fi)

Run with host binding:

```bash
HOST=0.0.0.0 PORT=3000 npm start
```

Then open from your father's laptop:

`http://YOUR_LOCAL_IP:3000` (example: `http://192.168.1.10:3000`)

To find your local IP on macOS:

```bash
ipconfig getifaddr en0
```

## API Endpoints

- `GET /api/meta`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/categories`
- `POST /api/categories`
- `PUT /api/categories/:id`
- `DELETE /api/categories/:id`
- `GET /api/expenses`
- `POST /api/expenses`
- `PUT /api/expenses/:id`
- `DELETE /api/expenses/:id`
- `GET /api/stats`

## Deploy Publicly With HTTPS

### Option A: Render (easy)

1. Push this project to a GitHub repository.
2. On [Render](https://render.com), create a new **Web Service**.
3. Select your repo and set:
   - Build command: `npm install`
   - Start command: `npm start`
4. Add environment variables:
   - `HOST=0.0.0.0`
   - `PORT=10000` (or Render default)
5. Deploy. Render provides an HTTPS URL like:
   - `https://your-app-name.onrender.com`

### Option B: Railway

1. Push this project to GitHub.
2. Create a new project on [Railway](https://railway.app) from that repo.
3. Add environment variable:
   - `HOST=0.0.0.0`
4. Deploy and use the generated HTTPS domain.

## Password Reset Notes

- Current setup generates a reset token directly in the app flow for simplicity.
- For production with real email delivery, integrate an email provider and send the token via email.
