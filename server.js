const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

const DEFAULT_CATEGORIES = [
  { id: "cat-food", name: "Food & Dining" },
  { id: "cat-transport", name: "Transport" },
  { id: "cat-housing", name: "Housing" },
  { id: "cat-utilities", name: "Utilities" },
  { id: "cat-health", name: "Health" },
  { id: "cat-entertainment", name: "Entertainment" },
  { id: "cat-shopping", name: "Shopping" },
  { id: "cat-education", name: "Education" },
  { id: "cat-travel", name: "Travel" },
  { id: "cat-misc", name: "Miscellaneous" }
];

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD", "SGD", "OMR"];
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RESET_TOKEN_TTL_MS = 1000 * 60 * 15;
const OTP_TTL_MS = 1000 * 60 * 5;
const sessions = new Map();
const passwordResetTokens = new Map();
const otpRequests = new Map();

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = { users: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), "utf8");
  }
}

function readDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return migrateLegacyDb(parsed);
}

function writeDb(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function validateDate(dateString) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateString);
}

function cloneDefaultCategories() {
  return DEFAULT_CATEGORIES.map((item) => ({ id: generateId("cat"), name: item.name }));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  return hashPassword(password, salt).hash === hash;
}

function migrateLegacyDb(db) {
  if (Array.isArray(db.users)) return db;
  const legacyCategories = Array.isArray(db.categories) ? db.categories : cloneDefaultCategories();
  const legacyExpenses = Array.isArray(db.expenses) ? db.expenses : [];
  const defaultPass = hashPassword("changeme123");
  return {
    users: [
      {
        id: generateId("usr"),
        username: "owner",
        fullName: "Owner",
        passwordSalt: defaultPass.salt,
        passwordHash: defaultPass.hash,
        categories: legacyCategories,
        expenses: legacyExpenses
      }
    ]
  };
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("=") || "");
    return acc;
  }, {});
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  const secureCookie = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax${secureCookie}; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000
    )}`
  );
}

function clearSession(req, res) {
  const cookies = parseCookies(req);
  if (cookies.session) sessions.delete(cookies.session);
  const secureCookie = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `session=; HttpOnly; Path=/; SameSite=Lax${secureCookie}; Max-Age=0`);
}

function clearAllUserSessions(userId) {
  for (const [token, session] of sessions.entries()) {
    if (session.userId === userId) sessions.delete(token);
  }
}

function getUserFromSession(req, db) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return db.users.find((u) => u.id === session.userId) || null;
}

function createPasswordResetToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  passwordResetTokens.set(token, { userId, expiresAt: Date.now() + RESET_TOKEN_TTL_MS });
  return token;
}

function consumePasswordResetToken(token) {
  const reset = passwordResetTokens.get(token);
  if (!reset) return null;
  if (reset.expiresAt <= Date.now()) {
    passwordResetTokens.delete(token);
    return null;
  }
  passwordResetTokens.delete(token);
  return reset;
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createOtpRequest(userId, purpose) {
  const requestId = crypto.randomBytes(16).toString("hex");
  const otpCode = generateOtpCode();
  otpRequests.set(requestId, {
    userId,
    purpose,
    otpCode,
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_MS
  });
  return { requestId, otpCode };
}

function consumeOtpRequest(requestId, otpCode, purpose) {
  const request = otpRequests.get(requestId);
  if (!request) return { ok: false, error: "Invalid OTP request." };
  if (request.expiresAt <= Date.now()) {
    otpRequests.delete(requestId);
    return { ok: false, error: "OTP expired." };
  }
  if (request.purpose !== purpose) {
    return { ok: false, error: "OTP purpose mismatch." };
  }
  request.attempts += 1;
  if (request.attempts > 5) {
    otpRequests.delete(requestId);
    return { ok: false, error: "Too many invalid attempts." };
  }
  if (request.otpCode !== String(otpCode || "")) {
    return { ok: false, error: "Invalid OTP code." };
  }
  otpRequests.delete(requestId);
  return { ok: true, userId: request.userId };
}

function serveStaticFile(filePath, res) {
  const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(PUBLIC_DIR, safePath);
  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (err, content) => {
    if (err) {
      const requestedExt = path.extname(safePath);
      // Only SPA-fallback for clean routes (e.g. /dashboard), not for missing assets.
      if (requestedExt) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Asset not found");
        return;
      }

      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (indexErr, indexContent) => {
        if (indexErr) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(indexContent);
      });
      return;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    res.end(content);
  });
}

function buildStats(expenses, categories) {
  const byMonth = {};
  const byCategory = {};
  const byCurrency = {};
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  expenses.forEach((expense) => {
    const month = expense.date.slice(0, 7);
    const amount = Number(expense.amount);
    byMonth[month] = (byMonth[month] || 0) + amount;
    byCurrency[expense.currency] = (byCurrency[expense.currency] || 0) + amount;

    const categoryLabel = categoryMap[expense.categoryId] || "Uncategorized";
    byCategory[categoryLabel] = (byCategory[categoryLabel] || 0) + amount;
  });

  return { byMonth, byCategory, byCurrency };
}

async function handleApi(req, res, urlObj) {
  const db = readDb();
  const pathname = urlObj.pathname;
  const sessionUser = getUserFromSession(req, db);

  if (req.method === "GET" && pathname === "/api/meta") {
    return sendJson(res, 200, { currencies: CURRENCIES });
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    const body = await parseBody(req);
    const username = (body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const fullName = (body.fullName || "").trim();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      return sendJson(res, 400, { error: "Username must be 3-30 chars (letters, numbers, . _ -)." });
    }
    if (password.length < 6) {
      return sendJson(res, 400, { error: "Password must be at least 6 characters." });
    }
    if (db.users.some((u) => u.username === username)) {
      return sendJson(res, 409, { error: "Username already exists." });
    }
    const pwd = hashPassword(password);
    const user = {
      id: generateId("usr"),
      username,
      fullName: fullName || username,
      passwordSalt: pwd.salt,
      passwordHash: pwd.hash,
      categories: cloneDefaultCategories(),
      expenses: []
    };
    db.users.push(user);
    writeDb(db);
    createSession(res, user.id);
    return sendJson(res, 201, { id: user.id, username: user.username, fullName: user.fullName });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const username = (body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = db.users.find((u) => u.username === username);
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return sendJson(res, 401, { error: "Invalid username or password." });
    }
    createSession(res, user.id);
    return sendJson(res, 200, { id: user.id, username: user.username, fullName: user.fullName });
  }

  if (req.method === "POST" && pathname === "/api/auth/request-login-otp") {
    const body = await parseBody(req);
    const username = (body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = db.users.find((u) => u.username === username);
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return sendJson(res, 401, { error: "Invalid username or password." });
    }
    const otp = createOtpRequest(user.id, "login");
    return sendJson(res, 200, {
      message: "OTP generated.",
      otpRequestId: otp.requestId,
      otpCode: otp.otpCode,
      expiresInMinutes: Math.floor(OTP_TTL_MS / 60000)
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/verify-login-otp") {
    const body = await parseBody(req);
    const result = consumeOtpRequest(body.otpRequestId, body.otpCode, "login");
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    const user = db.users.find((u) => u.id === result.userId);
    if (!user) return sendJson(res, 404, { error: "User not found." });
    createSession(res, user.id);
    return sendJson(res, 200, { id: user.id, username: user.username, fullName: user.fullName });
  }

  if (req.method === "POST" && pathname === "/api/auth/forgot-password") {
    const body = await parseBody(req);
    const username = (body.username || "").trim().toLowerCase();
    const user = db.users.find((u) => u.username === username);
    if (!user) {
      return sendJson(res, 200, {
        message: "If the username exists, a reset instruction has been generated."
      });
    }
    const resetToken = createPasswordResetToken(user.id);
    return sendJson(res, 200, {
      message: "Reset token generated. Use it to set a new password.",
      resetToken,
      expiresInMinutes: Math.floor(RESET_TOKEN_TTL_MS / 60000)
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/request-reset-otp") {
    const body = await parseBody(req);
    const username = (body.username || "").trim().toLowerCase();
    const user = db.users.find((u) => u.username === username);
    if (!user) {
      return sendJson(res, 200, {
        message: "If the username exists, reset OTP instructions have been generated."
      });
    }
    const otp = createOtpRequest(user.id, "reset");
    return sendJson(res, 200, {
      message: "Reset OTP generated.",
      otpRequestId: otp.requestId,
      otpCode: otp.otpCode,
      expiresInMinutes: Math.floor(OTP_TTL_MS / 60000)
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/reset-password-otp") {
    const body = await parseBody(req);
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 6) {
      return sendJson(res, 400, { error: "New password must be at least 6 characters." });
    }
    const result = consumeOtpRequest(body.otpRequestId, body.otpCode, "reset");
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    const user = db.users.find((u) => u.id === result.userId);
    if (!user) return sendJson(res, 404, { error: "User not found." });
    const pwd = hashPassword(newPassword);
    user.passwordSalt = pwd.salt;
    user.passwordHash = pwd.hash;
    clearAllUserSessions(user.id);
    writeDb(db);
    return sendJson(res, 200, { message: "Password reset successful. Please log in again." });
  }

  if (req.method === "POST" && pathname === "/api/auth/reset-password") {
    const body = await parseBody(req);
    const resetToken = String(body.resetToken || "");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 6) {
      return sendJson(res, 400, { error: "New password must be at least 6 characters." });
    }
    const tokenData = consumePasswordResetToken(resetToken);
    if (!tokenData) {
      return sendJson(res, 400, { error: "Invalid or expired reset token." });
    }
    const user = db.users.find((u) => u.id === tokenData.userId);
    if (!user) return sendJson(res, 404, { error: "User not found." });
    const pwd = hashPassword(newPassword);
    user.passwordSalt = pwd.salt;
    user.passwordHash = pwd.hash;
    clearAllUserSessions(user.id);
    writeDb(db);
    return sendJson(res, 200, { message: "Password reset successful. Please log in again." });
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    clearSession(req, res);
    return sendNoContent(res);
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    if (!sessionUser) return sendJson(res, 401, { error: "Not authenticated." });
    return sendJson(res, 200, {
      id: sessionUser.id,
      username: sessionUser.username,
      fullName: sessionUser.fullName
    });
  }

  if (!sessionUser) {
    return sendJson(res, 401, { error: "Authentication required." });
  }

  const user = sessionUser;

  if (req.method === "POST" && pathname === "/api/auth/change-password") {
    const body = await parseBody(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)) {
      return sendJson(res, 401, { error: "Current password is incorrect." });
    }
    if (newPassword.length < 6) {
      return sendJson(res, 400, { error: "New password must be at least 6 characters." });
    }
    const pwd = hashPassword(newPassword);
    user.passwordSalt = pwd.salt;
    user.passwordHash = pwd.hash;
    clearAllUserSessions(user.id);
    createSession(res, user.id);
    writeDb(db);
    return sendJson(res, 200, { message: "Password changed successfully." });
  }

  if (req.method === "GET" && pathname === "/api/categories") {
    return sendJson(res, 200, user.categories);
  }

  if (req.method === "POST" && pathname === "/api/categories") {
    const body = await parseBody(req);
    const name = (body.name || "").trim();
    if (!name) return sendJson(res, 400, { error: "Category name is required." });

    const exists = user.categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
    if (exists) return sendJson(res, 409, { error: "Category already exists." });

    const category = { id: generateId("cat"), name };
    user.categories.push(category);
    writeDb(db);
    return sendJson(res, 201, category);
  }

  if (req.method === "PUT" && pathname.startsWith("/api/categories/")) {
    const categoryId = pathname.split("/").pop();
    const body = await parseBody(req);
    const name = (body.name || "").trim();
    if (!name) return sendJson(res, 400, { error: "Category name is required." });

    const category = user.categories.find((c) => c.id === categoryId);
    if (!category) return sendJson(res, 404, { error: "Category not found." });

    const duplicate = user.categories.some(
      (c) => c.id !== categoryId && c.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) return sendJson(res, 409, { error: "Category already exists." });

    category.name = name;
    writeDb(db);
    return sendJson(res, 200, category);
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/categories/")) {
    const categoryId = pathname.split("/").pop();
    const categoryIndex = user.categories.findIndex((c) => c.id === categoryId);
    if (categoryIndex === -1) return sendJson(res, 404, { error: "Category not found." });

    const inUse = user.expenses.some((e) => e.categoryId === categoryId);
    if (inUse) {
      return sendJson(res, 400, {
        error: "Category is used by expenses. Reassign or delete those expenses first."
      });
    }

    user.categories.splice(categoryIndex, 1);
    writeDb(db);
    return sendNoContent(res);
  }

  if (req.method === "GET" && pathname === "/api/expenses") {
    const expenses = [...user.expenses].sort((a, b) => (a.date < b.date ? 1 : -1));
    return sendJson(res, 200, expenses);
  }

  if (req.method === "POST" && pathname === "/api/expenses") {
    const body = await parseBody(req);
    const amount = Number(body.amount);
    const date = body.date;
    const currency = body.currency;
    const categoryId = body.categoryId;
    const description = (body.description || "").trim();

    if (!validateDate(date)) return sendJson(res, 400, { error: "Invalid date format." });
    if (!Number.isFinite(amount) || amount <= 0) {
      return sendJson(res, 400, { error: "Amount must be greater than zero." });
    }
    if (!user.categories.find((c) => c.id === categoryId)) {
      return sendJson(res, 400, { error: "Invalid category." });
    }
    if (!CURRENCIES.includes(currency)) {
      return sendJson(res, 400, { error: "Invalid currency." });
    }

    const expense = {
      id: generateId("exp"),
      amount: Number(amount.toFixed(2)),
      date,
      categoryId,
      currency,
      description
    };
    user.expenses.push(expense);
    writeDb(db);
    return sendJson(res, 201, expense);
  }

  if (req.method === "PUT" && pathname.startsWith("/api/expenses/")) {
    const expenseId = pathname.split("/").pop();
    const body = await parseBody(req);
    const expense = user.expenses.find((e) => e.id === expenseId);
    if (!expense) return sendJson(res, 404, { error: "Expense not found." });

    const amount = Number(body.amount);
    const date = body.date;
    const currency = body.currency;
    const categoryId = body.categoryId;
    const description = (body.description || "").trim();

    if (!validateDate(date)) return sendJson(res, 400, { error: "Invalid date format." });
    if (!Number.isFinite(amount) || amount <= 0) {
      return sendJson(res, 400, { error: "Amount must be greater than zero." });
    }
    if (!user.categories.find((c) => c.id === categoryId)) {
      return sendJson(res, 400, { error: "Invalid category." });
    }
    if (!CURRENCIES.includes(currency)) {
      return sendJson(res, 400, { error: "Invalid currency." });
    }

    expense.amount = Number(amount.toFixed(2));
    expense.date = date;
    expense.currency = currency;
    expense.categoryId = categoryId;
    expense.description = description;
    writeDb(db);
    return sendJson(res, 200, expense);
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/expenses/")) {
    const expenseId = pathname.split("/").pop();
    const index = user.expenses.findIndex((e) => e.id === expenseId);
    if (index === -1) return sendJson(res, 404, { error: "Expense not found." });
    user.expenses.splice(index, 1);
    writeDb(db);
    return sendNoContent(res);
  }

  if (req.method === "GET" && pathname === "/api/stats") {
    return sendJson(res, 200, buildStats(user.expenses, user.categories));
  }

  return sendJson(res, 404, { error: "API route not found." });
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const urlObj = new URL(req.url, `http://${host}`);

    if (urlObj.pathname.startsWith("/api/")) {
      await handleApi(req, res, urlObj);
      return;
    }

    const relativePath = urlObj.pathname === "/" ? "index.html" : urlObj.pathname.slice(1);
    serveStaticFile(relativePath, res);
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Internal server error." });
  }
});

server.listen(PORT, HOST, () => {
  ensureDataFile();
  console.log(`Expense app running on http://${HOST}:${PORT}`);
});
