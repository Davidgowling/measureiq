require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const { Pool } = require("pg");
const { Resend } = require("resend");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL;

// Resend is only needed for password-reset emails.
// If the API key is missing the server still starts — reset emails just won't send.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// --------------------------------------------------
// Database
// --------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --------------------------------------------------
// Middleware
// --------------------------------------------------
app.set("trust proxy", 1); // trust Railway's reverse proxy for accurate client IPs
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "..")));

// --------------------------------------------------
// Rate limiting — built-in, no external packages
// --------------------------------------------------
const _rlStore = new Map();
const RL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RL_MAX = 20;

// Prune expired entries every 15 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of _rlStore.entries()) {
    if (now > rec.resetAt) _rlStore.delete(key);
  }
}, RL_WINDOW_MS).unref();

function authLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const rec = _rlStore.get(ip) || { count: 0, resetAt: now + RL_WINDOW_MS };

  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + RL_WINDOW_MS;
  }

  rec.count += 1;
  _rlStore.set(ip, rec);

  if (rec.count > RL_MAX) {
    return res.status(429).json({ error: "Too many attempts. Please try again in 15 minutes." });
  }

  next();
}

// --------------------------------------------------
// DB INIT
// --------------------------------------------------
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      reset_token TEXT,
      reset_token_expires TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_data (
      user_id UUID PRIMARY KEY REFERENCES users(id),
      data JSONB,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Plan columns — safe to run on existing DBs
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free' NOT NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_note TEXT NULL`);

  // Logo column — stored separately to keep main data payloads small
  await pool.query(`ALTER TABLE user_data ADD COLUMN IF NOT EXISTS logo TEXT NULL`);

  console.log("✅ Database ready");
}

// --------------------------------------------------
// PLAN HELPERS
// --------------------------------------------------
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
);

const FREE_LIMITS = { customers: 3 };

/** Resolve the effective plan for a DB user row, handling expiry */
function effectivePlan(user) {
  if (ADMIN_EMAILS.has((user.email || "").toLowerCase())) return "admin";
  const plan = user.plan || "free";
  if (plan === "pro" && user.plan_expires_at && new Date(user.plan_expires_at) < new Date()) {
    return "free";
  }
  return plan;
}

// --------------------------------------------------
// Auth middleware
// --------------------------------------------------
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  try {
    req.user = jwt.verify(header.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// --------------------------------------------------
// AUTH
// --------------------------------------------------
app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: "A valid email address is required." });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const hash = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();

  try {
    const emailNorm = email.toLowerCase().trim();
    await pool.query(
      "INSERT INTO users (id, email, password) VALUES ($1,$2,$3)",
      [id, emailNorm, hash]
    );
    const plan = ADMIN_EMAILS.has(emailNorm) ? "admin" : "free";
    const token = jwt.sign({ id, email: emailNorm, plan }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch {
    res.status(400).json({ error: "User already exists" });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const r = await pool.query("SELECT * FROM users WHERE email=$1", [String(email).toLowerCase().trim()]);
  const user = r.rows[0];
  if (!user) return res.status(401).json({ error: "Invalid login" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid login" });

  const plan = effectivePlan(user);
  // Persist admin promotion if ADMIN_EMAILS matched
  if (plan === "admin" && user.plan !== "admin") {
    await pool.query("UPDATE users SET plan='admin' WHERE id=$1", [user.id]);
  }
  const token = jwt.sign({ id: user.id, email: user.email, plan }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

app.get("/api/me", authenticate, (req, res) => {
  res.json({ email: req.user.email, plan: req.user.plan || "free" });
});

// --------------------------------------------------
// FORGOT PASSWORD (NEW)
// --------------------------------------------------
app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
  const { email } = req.body;

  const r = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
  const user = r.rows[0];

  // Always respond OK (prevents email enumeration)
  if (!user) return res.json({ ok: true });

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 mins

  await pool.query(
    "UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3",
    [token, expires, user.id]
  );

  const resetUrl = `${FRONTEND_BASE_URL}/reset-password.html?token=${token}`;

  if (!resend) {
    console.warn("RESEND_API_KEY not set — password reset email not sent");
    return res.json({ ok: true });
  }

  await resend.emails.send({
    from: "MeasureIQ <no-reply@measureiq.app>",
    to: email,
    subject: "Reset your MeasureIQ password",
    html: `
      <p>You requested a password reset.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 30 minutes.</p>
    `
  });

  res.json({ ok: true });
});

app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  const { token, password } = req.body;

  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const r = await pool.query(
    "SELECT id FROM users WHERE reset_token=$1 AND reset_token_expires > NOW()",
    [token]
  );
  const user = r.rows[0];
  if (!user) return res.status(400).json({ error: "Invalid or expired token" });

  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    `
    UPDATE users
    SET password=$1, reset_token=NULL, reset_token_expires=NULL
    WHERE id=$2
    `,
    [hash, user.id]
  );

  res.json({ ok: true });
});

// --------------------------------------------------
// DATA ROUTES (unchanged)
// --------------------------------------------------
app.get("/api/load", authenticate, async (req, res) => {
  const r = await pool.query(
    "SELECT data FROM user_data WHERE user_id=$1",
    [req.user.id]
  );
  res.json(r.rows[0]?.data || {});
});

app.post("/api/save", authenticate, async (req, res) => {
  await pool.query(
    `
    INSERT INTO user_data (user_id, data)
    VALUES ($1,$2)
    ON CONFLICT (user_id)
    DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()
    `,
    [req.user.id, req.body]
  );
  res.json({ ok: true });
});

// --------------------------------------------------
// ADMIN ROUTES
// --------------------------------------------------
function requireAdmin(req, res, next) {
  if (req.user?.plan !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
}

app.get("/api/admin/users", authenticate, requireAdmin, async (req, res) => {
  const r = await pool.query(`
    SELECT id, email, plan, plan_expires_at, plan_note, created_at
    FROM users ORDER BY created_at DESC
  `);
  res.json(r.rows);
});

app.patch("/api/admin/users/:id/plan", authenticate, requireAdmin, async (req, res) => {
  const { plan, plan_expires_at, plan_note } = req.body;
  const validPlans = ["free", "pro", "admin"];
  if (!validPlans.includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  await pool.query(
    "UPDATE users SET plan=$1, plan_expires_at=$2, plan_note=$3 WHERE id=$4",
    [plan, plan_expires_at || null, plan_note || null, req.params.id]
  );
  res.json({ ok: true });
});

// --------------------------------------------------
// LOGO ROUTES
// --------------------------------------------------
app.get("/api/logo", authenticate, async (req, res) => {
  const r = await pool.query("SELECT logo FROM user_data WHERE user_id=$1", [req.user.id]);
  res.json({ logo: r.rows[0]?.logo || null });
});

app.post("/api/logo", authenticate, async (req, res) => {
  const { logo } = req.body;

  if (logo !== null && logo !== undefined) {
    if (typeof logo !== "string" || !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(logo)) {
      return res.status(400).json({ error: "Invalid image format. Use PNG, JPG, GIF, WebP or SVG." });
    }
    // ~2MB limit (base64 adds ~33% overhead so allow up to 2.7MB string length)
    if (logo.length > 2.7 * 1024 * 1024) {
      return res.status(400).json({ error: "Logo must be under 2MB." });
    }
  }

  await pool.query(
    `INSERT INTO user_data (user_id, logo) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET logo=EXCLUDED.logo`,
    [req.user.id, logo || null]
  );
  res.json({ ok: true });
});

// --------------------------------------------------
app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

// --------------------------------------------------
initDB().then(() => {
  app.listen(PORT, () =>
    console.log(`🚀 Server running on http://localhost:${PORT}`)
  );
});
