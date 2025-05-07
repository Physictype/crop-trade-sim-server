import https from "https";
import fs from "fs";
import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { admin } from "./firebase.js";
import cors from "cors";
// import { getDoc } from "firebase";

dotenv.config();

const privateKey = fs.readFileSync("decrypted-private-key.pem", "utf8");
const certificate = fs.readFileSync("certificate.pem", "utf8");
if (!privateKey || !certificate) {
	throw new Error("SSL certificate or private key not found.");
}
const credentials = { key: privateKey, cert: certificate };

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'none'; connect-src 'self' http://localhost:3000;"
	); // Allow connections to the backend API
	next();
});
const corsOptions = {
	origin: "http://localhost:5173", // Allow requests from your frontend
	methods: ["GET", "POST", "PUT", "DELETE"],
};

app.use(cors(corsOptions));

const SESSION_COOKIE_NAME = "session";

let firestore = admin.firestore();

// // 🔐 Middleware to protect routes
// function authenticateSession(req, res, next) {
//   const sessionCookie = req.cookies[SESSION_COOKIE_NAME] || "";

//   admin
//     .auth()
//     .verifySessionCookie(sessionCookie, true)
//     .then((decodedClaims) => {
//       req.user = decodedClaims;
//       next();
//     })
//     .catch(() => res.status(401).send("Unauthorized"));
// }

// // 📥 Login endpoint
// app.post("/login", async (req, res) => {
//   const idToken = req.body.idToken;

//   if (!idToken) return res.status(400).send("Missing idToken");

//   const expiresIn = Number(process.env.SESSION_EXPIRES_MS);

//   try {
//     const sessionCookie = await admin
//       .auth()
//       .createSessionCookie(idToken, { expiresIn });
//     res.cookie(SESSION_COOKIE_NAME, sessionCookie, {
//       maxAge: expiresIn,
//       httpOnly: true,
//       secure: true,
//       sameSite: "Strict",
//     });
//     res.send("Logged in with secure session.");
//   } catch (err) {
//     res.status(401).send("Invalid ID token");
//   }
// });

// // 🧼 Logout endpoint
// app.post("/logout", (req, res) => {
//   res.clearCookie(SESSION_COOKIE_NAME);
//   res.send("Logged out");
// });

// // 🔒 Protected route
// app.get("/profile", authenticateSession, (req, res) => {
//   res.send(`Hello, user ${req.user.uid}`);
// });

// TODO: add checks so no injects
// TODO: add middleware to verify user
app.post("/progressSeason", async (req,res) => {
	
})
app.post("/plantSeed", async (req, res) => {
	let playerData = (
		await firestore
			.doc(
				"games/" +
					req.body.gameId.toString() +
					"/players/" +
					req.body.userId.toString()
			)
			.get()
	).data();
	if (!(req.body.seed in playerData.seeds) || playerData.seeds[req.body.seed]<1) {
		res.status(403).send("Insufficient Seeds");
	}
	if (req.body.idx < 0 || req.body.idx >= playerData.crops.length) {
		res.status(400).send("Planting out of range.");
	}
	playerData.seeds[req.body.seed]--;
	playerData.crops[req.body.idx].stage = 0;
	playerData.crops[req.body.idx].type = req.body.seed;
})

app.post("/buySeed", async (req, res) => {
	console.log(req.body.seed);
	let seedCosts = (
		await firestore.doc("games/" + req.body.gameId.toString()).get()
	).data().seedCosts;
	let playerData = (
		await firestore
			.doc(
				"games/" +
					req.body.gameId.toString() +
					"/players/" +
					req.body.userId.toString()
			)
			.get()
	).data();
	if (seedCosts[req.body.seed] * req.body.count > playerData.money) {
		res.status(403).send('Insufficient Currency');
		return;
	}
	playerData.money -= seedCosts[req.body.seed] * req.body.count;
	if (req.body.seed in playerData.seeds) {
		playerData.seeds[req.body.seed] += req.body.count;
	} else {
		playerData.seeds[req.body.seed] = req.body.count;
	}
	await firestore
		.doc("games/28291038/players/" + req.body.userId.toString())
		.set(playerData);
	res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
https.createServer(credentials, app).listen(PORT, () => {
	console.log(`Server running on https://localhost:${PORT}`);
});
