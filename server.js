const express = require("express");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const admin = require("./firebase");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const SESSION_COOKIE_NAME = "session";

// 🔐 Middleware to protect routes
function authenticateSession(req, res, next) {
  const sessionCookie = req.cookies[SESSION_COOKIE_NAME] || "";

  admin.auth().verifySessionCookie(sessionCookie, true)
    .then(decodedClaims => {
      req.user = decodedClaims;
      next();
    })
    .catch(() => res.status(401).send("Unauthorized"));
}

// 📥 Login endpoint
app.post("/login", async (req, res) => {
  const idToken = req.body.idToken;

  if (!idToken) return res.status(400).send("Missing idToken");

  const expiresIn = Number(process.env.SESSION_EXPIRES_MS);

  try {
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    res.cookie(SESSION_COOKIE_NAME, sessionCookie, {
      maxAge: expiresIn,
      httpOnly: true,
      secure: true,
      sameSite: "Strict"
    });
    res.send("Logged in with secure session.");
  } catch (err) {
    res.status(401).send("Invalid ID token");
  }
});

// 🧼 Logout endpoint
app.post("/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.send("Logged out");
});

// 🔒 Protected route
app.get("/profile", authenticateSession, (req, res) => {
  res.send(`Hello, user ${req.user.uid}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});
