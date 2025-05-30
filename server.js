import https from "https";
import fs from "fs";
import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import firebaseAdmin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json" with { type: "json" };

export const admin = firebaseAdmin.initializeApp({
	credential: firebaseAdmin.credential.cert(serviceAccount),
});
import { doc, collection, updateDoc, getDocs } from "firebase/firestore";
import cors from "cors";
import _ from "lodash";
// import { getDoc } from "firebase";

dotenv.config();

// const privateKey = fs.readFileSync("decrypted-private-key.pem", "utf8");
// const certificate = fs.readFileSync("certificate.pem", "utf8");
// if (!privateKey || !certificate) {
// 	throw new Error("SSL certificate or private key not found.");
// }
// const credentials = { key: privateKey, cert: certificate };
function getRef(firestore, ...pathParts) {
	let ref = firestore;

	for (let i = 0; i < pathParts.length; i++) {
		ref =
			i % 2 === 0 ? ref.collection(pathParts[i]) : ref.doc(pathParts[i]);
	}
	return ref;

	return ref;
}

function uto0(x) {
	if (x == null) {
		return 0;
	}
	return x;
}

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
app.use(
	cors({
		origin: "http://localhost:5173", // exact frontend origin here
		credentials: true, // allow cookies/auth credentials
	})
);

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
async function checkInGame(req, res, next) {
	let players = await getDocs(
		getRef(firestore,"games", req.body.gameId, "players")
	).docs.map((doc) => doc.id);
	if (players.includes(req.user.uid)) {
		next();
	} else {
		return res.status(403).send("You are not in this game.");
	}
}

// TODO: add checks so no injects
// TODO: add middleware to verify user
// TODO: mutex or check for changes??? prevent race conditions
let admins = [];
app.post("/createGame", authenticateSession, async (req, res) => {
	if (true || admins.includes(req.user.uid)) {
		// TODO: remove || true
		let gameData = {
			cropsList: req.body.cropsList,
			currentRound: 0,
			numRounds: req.body.numRounds,
			plantingTime: req.body.plantingTime,
			offeringTime: req.body.offeringTime,
			tradingTime: req.body.tradingTime,
			plotWidth: req.body.plotWidth,
			plotHeight: req.body.plotHeight,
			roundSection: "planting",
			season: 0,
		};
		// must add checks, but for now its fine
		async function generateGameID() {
			// maybe change this function?
			let currentIds = await getDocs(collection(firestore, "games"));
			function stringDigit() {
				return "0123456789"[Math.floor(Math.random() * 10)];
			}
			while (true) {
				let id = "";
				for (let i = 0; i < 10; i++) {
					id += stringDigit();
				}
				if (!currentIds.includes(id)) {
					return id;
				}
			}
		}
		let id = generateGameID();
		await setDoc(getRef(firestore, "games", id), gameData);
		return res.status(200).send(id);
	} else {
		return res.status(401).send("Unauthorized");
	}
});
app.post("/joinGame", authenticateSession, async (req, res) => {
	try {
		firestore.runTransaction(async (transaction) => {
			let gameDataDoc = getRef(firestore, "games", req.body.gameId);
			let playerRef = getRef(
				firestore,
				"games",
				req.body.gameId,
				"players",
				req.user.uid
			);
			let playersRef = getRef(firestore,
				"games",
				req.body.gameId,
				"players"
			);
			let [gameDataSnapshot, playersSnapshot] = await Promise.all([
				transaction.get(gameDataDoc),
				transaction.getDocs(playersRef),
			]);
			let gameData = gameDataSnapshot.data();
			if (gameData.currentRound != 0) {
				throw new Error("Game already started.");
			}
			let players = playersSnapshot.docs.map((doc) => doc.id);
			if (req.user.uid in players) {
				throw new Error("You have already joined the game.");
			}
			await transaction.setDoc(playerRef, {
				crops: {},
				money: gameData.initialMoney,
				plot: {},
				seeds: {},
			});
		});
		return res.status(200).send("Game joined.");
	} catch (e) {
		return res.status(409).send(e.message || "Conflict. Please try again.");
	}
});
// TODO: FIX THIS FUNCTION BC ITS RLY JANKY
async function nextSeason(gameDataDoc, season,gameId) {
	await firestore.runTransaction(async (transaction) => {
        let [gameDataSnapshot,players] = await Promise.all([transaction.get(gameDataDoc),transaction.get(getRef(firestore,"games", gameId, "players"))]);
        let gameData = gameDataSnapshot;
		players.forEach(async (doc) => {
			let player = doc.data();
            console.log(player)
			Object.keys(player.plot).forEach((idx) => {
				if (player.plot[idx].type != "") {
					player.plot[idx].stage++;
					if (
						(player.plot[idx].stage >=
							gameData.cropsList[player.plot[idx].type].minSeasons) &&
						(gameData.cropsList[player.plot[idx].type].seasonsMap &
							(1 << gameData.season > 0))
					) {
						if (player.plot[idx].type in player.crops) {
							player.crops[player.plot[idx].type]++;
						} else {
							player.crops[player.plot[idx].type] = 1;
						}
						player.plot[idx].type = "";
						player.plot[idx].stage = 0;
					}
				}
			});
            console.log("here?");
			transaction.update(getRef(firestore,"games",gameId,"players",doc), player);
		});
        console.log("or here?")
		transaction.update(gameDataDoc, { season: season + 1 });
	});
    console.log("or im stupid?")
}
async function roundLoop(gameDataDoc,gameId) {
	var gameData = (await gameDataDoc.get()).data();
	if (gameData.currentRound >= gameData.numRounds) {
		return;
	}
    console.log('hi')
	await gameDataDoc.update({
		currentRound: gameData.currentRound + 1,
	});
	console.log("loop1");
	setTimeout(async function () {
		await gameDataDoc.update({ roundSection: "offering" });
		nextSeason(gameDataDoc, gameData.season, gameId);
		setTimeout(async function () {
			await gameDataDoc.update( { roundSection: "trading" });
			setTimeout(async function () {
				await gameDataDoc.update( { roundSection: "planting" });
				roundLoop();
			}, gameData.tradingTime * 1000);
		}, gameData.offeringTime * 1000);
	}, gameData.plantingTime * 1000);
}
app.post("/startGame", async (req, res) => {
	// TODO: ADD authenticateSession,
	if (true || admins.includes(req.user.uid)) {
		let gameDataDoc = await getRef(firestore, "games", req.body.gameId);
		let gameData = (await gameDataDoc.get()).data();
		if (gameData.currentRound > 0) {
            console.log(gameData.currentRound);
			return res.status(409).send("Game already started.");
		} else {
			roundLoop(gameDataDoc,req.body.gameId);
			return res.status(200).send("Game started.");
		}
	} else {
		return res.status(401).send("Unauthorized");
	}
});
app.post("/offerCrop", authenticateSession, checkInGame, async (req, res) => {
	try {
		await firestore.runTransaction(async (transaction) => {
			let gameDataDoc = getRef(firestore, "games", req.body.gameId);
			let playerDataDoc = getRef(
				firestore,
				"games",
				req.body.gameId.toString(),
				"players",
				req.user.uid.toString()
			);
			let [gameDataSnapshot, playerDataSnapshot] = await Promise.all([
				transaction.get(gameDataDoc),
				transaction.get(playerDataDoc),
			]);
			let gameData = gameDataSnapshot.data();
			if (gameData.currentRound > gameData.numRounds) {
				throw new Error("The game has ended.");
			}
			if (gameData.roundSection != "offering") {
				throw new Error(
					"You may only do this during the offering phase."
				);
			}
			let playerData = playerDataSnapshot.data();
			playerData.offers[req.body.crop] = {
				num: parseInt(req.body.num),
				pricePer: parseInt(req.body.price),
			};
			if (
				!(
					playerData.offers[req.body.crop].num <=
					playerData.crops[req.body.crop]
				)
			) {
				throw new Error(
					"You are trying to offer more crops than you have."
				);
			}
			playerDataDoc.update(playerData);
		});
		return res.status(200).send("Crop offered.");
	} catch (e) {
		return res.status(409).send(e.message || "Conflict. Please try again.");
	}
});
app.post(
	"/tradeFromOffer",
	authenticateSession,
	checkInGame,
	async (req, res) => {
		try {
			await firestore.runTransaction(async (transaction) => {
				let gameDataDoc = getRef(firestore, "games", req.body.gameId);
				let playerDataDoc = await getRef(
					firestore,
					"games",
					req.body.gameId.toString(),
					"players",
					req.user.uid.toString()
				);
				let otherDataDoc = getRef(
					firestore,
					"games",
					req.body.gameId.toString(),
					"players",
					req.body.targetId.toString()
				);
				let [gameDataSnapshot, playerDataSnapshot, otherDataSnapshot] =
					await Promise.all([
						transaction.get(gameDataDoc),
						transaction.get(playerDataDoc),
						transaction.get(otherDataDoc),
					]);
				let gameData = gameDataSnapshot.data();
				if (gameData.currentRound > gameData.numRounds) {
					throw new Error("The game has ended.");
				}
				if (gameData.roundSection != "trading") {
					throw new Error(
						"You may only do this during the trading phase."
					);
				}
				if (req.user.uid == req.body.targetId) {
					throw new Error("You cannot trade with yourself."); // ?
				}
				let playerData = playerDataSnapshot.data();
				let otherData = otherDataSnapshot.data();
				if (
					playerData.money <
					req.body.num * otherData.offers[req.body.type].pricePer
				) {
					throw new Error("You do not have enough money.");
				}
				if (req.body.num > otherData.offers[req.body.type].num) {
					throw new Error(
						"That is more than the other player is offering."
					);
				}
				transaction.update(playerData, {
					money:
						money -
						req.body.num * otherData.offers[req.body.type].pricePer,
					[`crops.${req.body.type}`]:
						playerData.crops[req.body.type] + req.body.num,
				});
				transaction.update(otherData, {
					money:
						money +
						req.body.num * otherData.offers[req.body.type].pricePer,
					[`crops.${req.body.type}`]:
						playerData.crops[req.body.type] - req.body.num,
					[`offers.${req.body.type}.num`]:
						otherData.offers[req.body.type].num - req.body.num,
				});
			});
			return res.status(200).send("Trade completed.");
		} catch (e) {
			return res
				.status(409)
				.send(e.message || "Conflict. Please try again.");
		}
	}
);
app.post("/plantSeed", async (req, res) => {
	console.log("hi");
	// authenticateSession, checkInGame, TODO: YOU BETTER REMEMBER TO ADD THIS BACK
	req.user = { uid: req.body.userId };
	try {
		await firestore.runTransaction(async (transaction) => {
			let gameDataDoc = getRef(firestore, "games", req.body.gameId);
			let playerDataDoc = getRef(
				firestore,
				"games",
				req.body.gameId.toString(),
				"players",
				req.user.uid.toString()
			);
			let [gameDataSnap, playerDataSnap] = await Promise.all([
				transaction.get(gameDataDoc),
				transaction.get(playerDataDoc),
			]);

			let gameData = gameDataSnap.data();
			let playerData = playerDataSnap.data();
			if (gameData.currentRound > gameData.numRounds) {
				throw new Error("The game has ended.");
			}
			if (gameData.roundSection != "planting") {
				throw new Error(
					"You may only do this during the planting phase."
				);
			}

			if (
				!(req.body.seed in playerData.seeds) ||
				playerData.seeds[req.body.seed] < 1
			) {
				throw new Error("Insufficient Seeds.");
			}
			if (
				!gameData.cropsList
					.map((crop) => crop.name)
					.includes(req.body.seed)
			) {
				throw new Error("That crop isn't in play.");
			}
			// if (req.body.idx < 0 || req.body.idx >= playerData.plot.length) {
			// 	throw new Error("Planting out of range.");
			// }
			transaction.update(playerDataDoc, {
				[`seeds.${req.body.seed}`]: playerData.seeds[req.body.seed] - 1,
				[`plot.${req.body.idx}.stage`]: 0,
				[`plot.${req.body.idx}.type`]: req.body.seed,
			});
		});
		console.log("hi");
		return res.status(200).send("Seed planted.");
	} catch (e) {
		return res.status(409).send(e.message || "Conflict. Please try again.");
	}
});

app.post("/buySeed", authenticateSession, checkInGame, async (req, res) => {
	try {
		await firestore.runTransaction(async (transaction) => {
			let gameDataDoc = getRef(firestore, "games", req.body.gameId);
			let playerDataDoc = getRef(
				firestore,
				"games",
				req.body.gameId.toString(),
				"players",
				req.user.uid.toString()
			);
			let [gameDataSnapshot, playerDataSnapshot] = await Promise.all([
				transaction.get(gameDataDoc),
				transaction.get(playerDataDoc),
			]);
			let gameData = gameDataSnapshot.data();
			let playerData = playerDataSnapshot.data();
			if (gameData.currentRound > gameData.numRounds) {
				throw new Error("The game has ended.");
			}
			if (gameData.roundSection != "planting") {
				throw new Error(
					"You may only do this during the planting phase."
				);
			}
			let seedCosts = gameData.seedCosts;

			if (seedCosts[req.body.seed] * req.body.count > playerData.money) {
				throw new Error("Insufficient Currency");
			}

			transaction.update(playerDataDoc, {
				money:
					playerData.money -
					seedCosts[req.body.seed] * req.body.count,
				[`seeds.${req.body.seed}`]:
					uto0(playerData.seeds[req.body.seed]) + req.body.count,
			});
		});
		return res.status(200).send("Seed bought.");
	} catch (e) {
		return res.status(409).send(e.message || "Conflict. Please try again.");
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server running on https://localhost:${PORT}`);
});
