import https from "https";
import fs from "fs";
import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { admin } from "./firebase.js";
import { doc, collection, updateDoc, getDocs } from "firebase/firestore";
import cors from "cors";
import _ from "lodash";
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
async function checkInGame(req, res, next) {
	let players = await getDocs(
		collection("games", req.body.gameId, "players")
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
	if (admins.includes(req.user.uid) || true) {
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
		await setDoc(doc(firestore, "games", id), gameData);
		return res.status(200).send(id);
	} else {
		return res.status(401).send("Unauthorized");
	}
});
app.post("/joinGame", authenticateSession, async (req, res) => {
	let gameDataDoc = firestore.doc("games", req.body.gameId);
	let gameDataSnapshot = await gameDataDoc.get();
	let gameData = gameDataSnapshot.data();
	let playerRef = firestore.doc(
		"games",
		req.body.gameId,
		"players",
		req.user.uid
	);
	if (gameData.currentRound != 0) {
		return res.status(409).send("Game already started.");
	}
    let players = await getDocs(
		collection("games", req.body.gameId, "players")
	).docs.map((doc) => doc.id);
	if (req.user.uid in players) {
		return res.status(409).send("You have already joined the game.");
	}
	await setDoc(playerRef, {
		crops: {},
		money: gameData.initialMoney,
		plot: Array.from(
			Array(gameData.plotWidth * gameData.plotHeight),
			(x) => {
				return { type: "", stage: 0 };
			}
		),
		seeds: {},
	});
	if (!_.isEqual((await gameDataDoc.get()).data(), oldGameData)) {
		return res.status(503).send("Please try again.");
	}
	gameDataDoc.update(gameData);
	return res.status(200).send("Game joined.");
});
// TODO: FIX THIS FUNCTION BC ITS RLY JANKY
function nextSeason(gameData) {
	gameData.roundSection = "offering";
	Object.entries(gameData.players).forEach(([playerId, player]) => {
		player.plot.forEach((crop) => {
			if (crop.type != "") {
				crop.stage++;
				if (
					crop.stage >= gameData.cropsList[crop.type].minSeasons &&
					gameData.cropsList[crop.type].seasonsMap &
						(1 << gameData.season > 0)
				) {
					if (crop.type in player.crops) {
						player.crops[crop.type]++;
					} else {
						player.crops[crop.type] = 1;
					}
					crop.type = "";
					crop.stage = 0;
				}
			}
		});
	});
	gameData.season++;
	currentTimeLeft = gameData.offeringTime;
	return gameData;
}
async function roundLoop(gameDataDoc) {
	var gameData = await gameDataDoc.get().data();
	if (gameData.currentRound >= gameData.numRounds) {
		return;
	}
	await updateDoc(gameDataDoc, {
		currentRound: gameData.currentRound + 1,
	});
	setTimeout(async function () {
		await updateDoc(gameDataDoc, { roundSection: "offering" });
		gameDataDoc.update(nextSeason(await gameDataDoc.get().data()));
		setTimeout(async function () {
			await updateDoc(gameDataDoc, { roundSection: "trading" });
			setTimeout(async function () {
				await updateDoc(gameDataDoc, { roundSection: "planting" });
				roundLoop();
			}, gameData.tradingTime * 1000);
		}, gameData.offeringTime * 1000);
	}, gameData.plantingTime * 1000);
}
app.post("/startGame", authenticateSession, async (req, res) => {
	if (admins.includes(req.user.uid) || true) {
		let gameDataDoc = await firestore.doc("games", req.body.gameId);
		let gameData = await gameDataDoc.get().data();
		if (gameData.currentRound > 0) {
			return res.status(409).send("Game already started.");
		} else {
			let gameDataDoc = await firestore.doc("games", req.body.gameId);
			roundLoop(gameDataDoc);
			return res.status(200).send("Game started.");
		}
	} else {
		return res.status(401).send("Unauthorized");
	}
});
app.post("/offerCrop", authenticateSession, checkInGame, async (req, res) => {
	let gameDataDoc = firestore.doc("games", req.body.gameId);
	let gameData = await gameDataDoc.get().data();
	if (gameData.currentRound > gameData.numRounds) {
		return res.status(403).send("The game has ended.");
	}
	if (gameData.currentStage != "offering") {
		return res
			.status(403)
			.send("You may only do this during the offering phase.");
	}
	let playerDataDoc = firestore.doc(
		"games",
		req.body.gameId.toString(),
		"players",
		req.user.uid.toString()
	);
	let playerDataSnapshot = await playerDataDoc.get();
	let playerData = playerDataSnapshot.data();
	let oldPlayerData = playerDataSnapshot.data();
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
		return res
			.status(403)
			.send("You are trying to offer more crops than you have.");
	}
	if (!_.isEqual(await playerDataDoc.get().data(), oldPlayerData)) {
		return res.status(503).send("Please try again.");
	}
	playerDataDoc.update(playerData);
	return res.status(200).send("Crop offered.");
});
app.post(
	"/tradeFromOffer",
	authenticateSession,
	checkInGame,
	async (req, res) => {
		let gameDataDoc = firestore.doc("games", req.body.gameId);
		let gameData = await gameDataDoc.get().data();
		if (gameData.currentRound > gameData.numRounds) {
			return res.status(403).send("The game has ended.");
		}
		if (gameData.currentStage != "trading") {
			return res
				.status(403)
				.send("You may only do this during the trading phase.");
		}
		if (req.user.uid == req.body.targetId) {
			return res.status(403).send("You cannot trade with yourself."); // ?
		}
		let playerDataDoc = await firestore.doc(
			"games",
			req.body.gameId.toString(),
			"players",
			req.user.uid.toString()
		);
		let playerDataSnapshot = await playerDataDoc.get();
		let otherDataDoc = firestore.doc(
			"games",
			req.body.gameId.toString(),
			"players",
			req.body.targetId.toString()
		);
		let otherDataSnapshot = await otherDataDoc.get();
		let playerData = playerDataSnapshot.data();
		let oldPlayerData = playerDataSnapshot.data();
		let otherData = otherDataSnapshot.data();
		let oldOtherData = otherDataSnapshot.data();
		if (
			playerData.money <
			req.body.num * otherData.offers[req.body.type].pricePer
		) {
			return res.status(422).send("You do not have enough money.");
		}
		if (req.body.num > otherData.offers[req.body.type].num) {
			return res
				.status(422)
				.send("That is more than the other player is offering.");
		}
		playerData.money -=
			req.body.num * otherData.offers[req.body.type].pricePer;
		otherData.money +=
			req.body.num * otherData.offers[req.body.type].pricePer;
		if (!(req.body.type in playerDataDoc.crops)) {
			playerDataDoc.crops[req.body.type] = 0;
		}
		playerData.crops[req.body.type] += req.body.num;
		otherData.crops[req.body.type] -= req.body.num;
		otherData.offers[req.body.type].num -= req.body.num;
		if (
			!(
				_.isEqual(await playerDataDoc.get().data(), oldPlayerData) &&
				_.isEqual(await otherDataDoc.get().dat(), oldOtherData)
			)
		) {
			res.status(503).send("Please try again.");
		}
		playerDataDoc.update(playerData);
		otherDataDoc.update(otherData);
		return res.status(200).send("Trade completed.");
	}
);
app.post("/plantSeed", authenticateSession, checkInGame, async (req, res) => {
	let gameDataDoc = firestore.doc("games", req.body.gameId);
	let gameData = await gameDataDoc.get().data();
	if (gameData.currentRound > gameData.numRounds) {
		return res.status(403).send("The game has ended.");
	}
	if (gameData.currentStage != "planting") {
		return res
			.status(403)
			.send("You may only do this during the planting phase.");
	}
	let playerDataDoc = firestore.doc(
		"games",
		req.body.gameId.toString(),
		"players",
		req.user.uid.toString()
	);
	let playerDataSnapshot = await playerDataDoc.get();
	let playerData = playerDataSnapshot.data();
	let oldPlayerData = playerDataSnapshot.data();

	let cropsList = (
		await firestore.doc("games", req.body.gameId.toString()).get()
	).data().cropsList;

	if (
		!(req.body.seed in playerData.seeds) ||
		playerData.seeds[req.body.seed] < 1
	) {
		return res.status(422).send("Insufficient Seeds");
	}
	if (!cropsList.includes(req.body.seed)) {
		return res.status(422).send("That crop is not in play.");
	}
	if (req.body.idx < 0 || req.body.idx >= playerData.plot.length) {
		return res.status(422).send("Planting out of range.");
	}

	playerData.seeds[req.body.seed]--;
	playerData.plot[req.body.idx].stage = 0;
	playerData.plot[req.body.idx].type = req.body.seed;
	if (!_.isEqual(await playerDataDoc.get().data(), oldPlayerData)) {
		return res.status(503).send("Please try again.");
	}
	playerDataDoc.update(playerData);
	return res.status(200).send("Seed planted.");
});

app.post("/buySeed", authenticateSession, checkInGame, async (req, res) => {
	let gameDataDoc = firestore.doc("games", req.body.gameId);
	let gameData = await gameDataDoc.get().data();
	if (gameData.currentRound > gameData.numRounds) {
		return res.status(403).send("The game has ended.");
	}
	if (gameData.currentStage != "planting") {
		return res
			.status(403)
			.send("You may only do this during the planting phase.");
	}
	let seedCosts = (
		await firestore.doc("games", req.body.gameId.toString()).get()
	).data().seedCosts;
	let playerDataDoc = firestore.doc(
		"games",
		req.body.gameId.toString(),
		"players",
		req.user.uid.toString()
	);
	let playerDataSnapshot = await playerDataDoc.get();
	let playerData = playerDataSnapshot.data();
	let oldPlayerData = playerDataSnapshot.data();

	if (seedCosts[req.body.seed] * req.body.count > playerData.money) {
		return res.status(422).send("Insufficient Currency");
	}

	playerData.money -= seedCosts[req.body.seed] * req.body.count;
	if (req.body.seed in playerData.seeds) {
		playerData.seeds[req.body.seed] += req.body.count;
	} else {
		playerData.seeds[req.body.seed] = req.body.count;
	}
	if (!_.isEqual((await playerDataDoc.get()).data(), oldPlayerData)) {
		return res.status(503).send("Please try again.");
	}
	playerDataDoc.update(playerData);
	return res.status(200).send("Seed bought.");
});

const PORT = process.env.PORT || 3000;
https.createServer(credentials, app).listen(PORT, () => {
	console.log(`Server running on https://localhost:${PORT}`);
});
