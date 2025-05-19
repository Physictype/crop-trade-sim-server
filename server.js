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

// 🔐 Middleware to protect routes
function authenticateSession(req, res, next) {
	const sessionCookie = req.cookies[SESSION_COOKIE_NAME] || "";
	if (req.user) {
		res.status(400);
		return;
	}
	admin
		.auth()
		.verifySessionCookie(sessionCookie, true)
		.then((decodedClaims) => {
			req.user = decodedClaims;
			next();
		})
		.catch(() => res.status(401).send("Unauthorized"));
}

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
app.post("/addTrade", authenticateSession, async (req, res) => {

});
app.post("/runTrades", authenticateSession, async (req, res) => {

})
app.post("/progressSeason", authenticateSession, async (req, res) => {
	let admins = [];
	
	if (admins.contains(req.user.uid) || true) { // TODO: remove || true please
		// req.body.gameId
		let gameDataDoc = await firestore.doc("games/"+req.body.gameId);
		let gameData = await gameDataDoc.get().data();
		Object.entries(gameData.players).forEach(([playerId,player]) => {
			player.plot.forEach((crop) => {
				if (crop.type != "") {
					crop.stage ++;
					if (crop.stage >= gameData.cropsList[crop.type].minSeasons && (gameData.cropsList[crop.type].seasonsMap & (1 << gameData.season) > 0)) {
						if (crop.type in player.crops) {
							player.crops[crop.type] ++;
						} else {
							player.crops[crop.type] = 1;
						}
						crop.type = "";
						crop.stage = 0;
					}
				}
			})
		})
		gameData.season ++;
		gameDataDoc.update(gameData);
	} else {
		res.status(401).send("Unauthorized");
	}
});

app.post("/plantSeed", authenticateSession, async (req, res) => {
	let playerData = (
		await firestore
			.doc(
				"games/" +
					req.body.gameId.toString() +
					"/players/" +
					req.user.uid.toString()
			)
			.get()
	).data();
	let cropsList = (
		await (await firestore.doc("games/" + req.body.gameId.toString())).get()
	).data().cropsList;

	if (
		!(req.body.seed in playerData.seeds) ||
		playerData.seeds[req.body.seed] < 1
	) {
		res.status(422).send("Insufficient Seeds");
		return;
	}
	if (!cropsList.includes(req.body.seed)) {
		res.status(422).send("That crop is not in play.");
		return;
	}
	if (req.body.idx < 0 || req.body.idx >= playerData.plot.length) {
		res.status(422).send("Planting out of range.");
		return;
	}

	playerData.seeds[req.body.seed]--;
	playerData.plot[req.body.idx].stage = 0;
	playerData.plot[req.body.idx].type = req.body.seed;
});

app.post("/buySeed", authenticateSession, async (req, res) => {
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
					req.user.uid.toString()
			)
			.get()
	).data();

	if (seedCosts[req.body.seed] * req.body.count > playerData.money) {
		res.status(422).send("Insufficient Currency");
		return;
	}

	playerData.money -= seedCosts[req.body.seed] * req.body.count;
	if (req.body.seed in playerData.seeds) {
		playerData.seeds[req.body.seed] += req.body.count;
	} else {
		playerData.seeds[req.body.seed] = req.body.count;
	}
	await firestore
		.doc(
			"games/" +
				req.body.gameId.toString() +
				"/players/" +
				req.user.uid.toString()
		)
		.set(playerData);
	res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
https.createServer(credentials, app).listen(PORT, () => {
	console.log(`Server running on https://localhost:${PORT}`);
});
