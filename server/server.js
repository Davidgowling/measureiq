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

const resend = new Resend(process.env.RESEND_API_KEY);

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
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "..")));

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

  console.log("✅ Database ready");
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
app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body;

  const hash = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();

  try {
    await pool.query(
      "INSERT INTO users (id, email, password) VALUES ($1,$2,$3)",
      [id, email, hash]
    );
    const token = jwt.sign({ id, email }, JWT_SECRET);
    res.json({ token });
  } catch {
    res.status(400).json({ error: "User already exists" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const r = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
  const user = r.rows[0];
  if (!user) return res.status(401).json({ error: "Invalid login" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid login" });

  const token = jwt.sign({ id: user.id, email }, JWT_SECRET);
  res.json({ token });
});

app.get("/api/me", authenticate, (req, res) => {
  res.json({ email: req.user.email });
});

// --------------------------------------------------
// FORGOT PASSWORD (NEW)
// --------------------------------------------------
app.post("/api/auth/forgot-password", async (req, res) => {
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

app.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body;

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
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

// --------------------------------------------------
initDB().then(() => {
  app.listen(PORT, () =>
    console.log(`🚀 Server running on http://localhost:${PORT}`)
  );
});
