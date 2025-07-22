import https from "https";
import fs from "fs";
import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import firebaseAdmin from "firebase-admin";
// import serviceAccount from "./serviceAccountKey.json" with { type: "json" };
// _
// import _ from "lodash";
dotenv.config();

export const admin = firebaseAdmin.initializeApp({
	credential: firebaseAdmin.credential.cert({
		projectId: process.env.FIREBASE_PROJECT_ID,
		private_key: JSON.parse(process.env.FIREBASE_PRIVATE_KEY).privateKey,
		client_email: process.env.FIREBASE_CLIENT_EMAIL,
	}),
});
import {
	doc,
	collection,
	updateDoc,
	getDocs,
	runTransaction,
} from "firebase/firestore";
import cors from "cors";
import _ from "lodash";
// import { getDoc } from "firebase";

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
		"default-src 'none'; connect-src 'self' https://crop-trade-sim.physictype.dev;"
	); // Allow connections to the backend API
	next();
});
app.use(
	cors({
		origin: "https://crop-trade-sim.physictype.dev", // exact frontend origin here
		credentials: true, // allow cookies/auth credentials
	})
);

const SESSION_COOKIE_NAME = "session";

let firestore = admin.firestore();

app.post("/sessionLogin", async (req, res) => {
	const idToken = req.body.idToken;

	try {
		const decodedToken = await admin.auth().verifyIdToken(idToken);

		// Optionally: create a custom session cookie (longer-lived)
		const expiresIn = 60 * 60 * 24 * 14 * 1000; // 14 days
		const sessionCookie = await admin
			.auth()
			.createSessionCookie(idToken, { expiresIn });

		// Set cookie (HttpOnly, Secure, SameSite=Strict recommended)
		res.cookie("session", sessionCookie, {
			httpOnly: true,
			secure: true, // only sent over HTTPS — disable for local dev if needed
			// TODO: MAKE TRUE
			sameSite: "none", // helps protect against CSRF
			maxAge: expiresIn,
		});

		res.status(200).send("Session cookie set");
	} catch (error) {
		res.status(401).send("Unauthorized");
	}
});

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
	let playersRef = await getRef(
		firestore,
		"games",
		req.body.gameId,
		"players"
	).get();

	let players = playersRef.docs.map((doc) => doc.id);
	if (players.includes(req.user.uid)) {
		next();
	} else {
		return res.status(403).send("You are not in this game.");
	}
}

function nestedIndex(obj, path) {
	let curr = obj;
	path.split(".").forEach((segment) => {
		curr = curr[segment];
	});
	return curr;
}
function assignNestedIndex(obj, path, val) {
	if (path.split(".").length == 1) {
		obj[path] = val;
		return obj;
	}
	let split = path.split(/\.(.*)/s);
	let head = split[0];
	let tail = split[1];
	obj[head] = assignNestedIndex(obj[head], tail, val);
	return obj;
}

function expandKeys(obj, path) {
	if (path.split(".").length == 1) {
		if (path == "*") {
			return Object.keys(obj);
		} else {
			return path;
		}
	}
	let split = path.split(/\.(.*)/s);
	let head = split[0];
	let tail = split[1];
	let res = [];
	if (head == "*") {
		Object.keys(obj).forEach((key) => {
			expandKeys(obj[key], tail).forEach((pathTail) => {
				res.push(key + "." + pathTail);
			});
		});
	} else {
		expandKeys(obj[head], tail).forEach((pathTail) => {
			res.push(head + "." + pathTail);
		});
	}
	return res;
}

function evaluateUpgrade(data, upgrade, target) {
	if (typeof upgrade == "undefined") {
		return NaN;
	}
	if (typeof upgrade == "number") {
		return upgrade;
	}
	if (upgrade == "this") {
		return nestedIndex(data, target);
	}
	if (typeof upgrade == "string") {
		return nestedIndex(data, upgrade);
	}
	let leftEval = evaluateUpgrade(data, upgrade.left, target);
	let rightEval = evaluateUpgrade(data, upgrade.right, target);
	switch (upgrade.operation) {
		case "+":
			return leftEval + rightEval;
		case "-":
			return leftEval - rightEval;
		case "*":
			return leftEval * rightEval;
		case "/":
			return leftEval / rightEval;
		case "&":
			return leftEval & rightEval;
		case "|":
			return leftEval | rightEval;
		default:
			return NaN;
	}
}
function applyUpgradeBundles(_player, _data) {
	let data = _.cloneDeep(_data);
	data.player = _.cloneDeep(_player);
	_player.upgradeBundles.forEach((upgradeBundle) => {
		upgradeBundle.upgrades.forEach((upgrade) => {
			let _data = _.cloneDeep(data);
			expandKeys(_data, upgrade.target).forEach((key) => {
				assignNestedIndex(
					data,
					key,
					evaluateUpgrade(_data, upgrade, key)
				);
			});
		});
	});
	return data.player;
}

function productUtilityDelta(num, max, type) {
	if (type == "linear") {
		return max - num + 1;
	} else if (type == "hyperbolic") {
		return max / num;
	} else {
		//if (type == "constant") {
		return 1;
	}
}

function productUtilityFunction(num, max, type) {
	let res = 0;
	for (let i = 1; i <= Math.min(num, max); i++) {
		res += productUtilityDelta(i, max, type);
	}
	return res;
}
function moneyUtilityFunction(money, type) {
	if (type == "linear") {
		return money;
	} else {
		// if (type == "logarithmic")
		return Math.log(money);
	}
}
function calculateUtility(playerData, gameData) {
	let utility = 0;
	Object.keys(gameData.availableProducts).forEach((product) => {
		let part = productUtilityFunction(
			uto0(playerData.products[product]),
			gameData.availableProducts[product].maxScored,
			gameData.productUtilityDecay
		);
		if (gameData.normalizeProductUtility) {
			part /= productUtilityFunction(
				gameData.availableProducts[product].maxScored,
				gameData.availableProducts[product].maxScored,
				gameData.productUtilityDecay
			);
			part *= 100;
		}
		utility += part;
	});
	utility *= gameData.productWeight;
	utility +=
		moneyUtilityFunction(playerData.money, gameData.moneyUtilityFunction) *
		gameData.moneyWeight;
	return utility;
}

// TODO: add checks so no injects especially for NaNs
// TODO: add middleware to verify user
// TODO: revert to using authenticateSession + other stuff
let admins = ["26SFR8BnWmUdbsDgAAbD6RFBlew1"];
// fetch("https://api.crop-trade-sim.physictype.dev/createCropType", {
// 	method: "POST",
// 	credentials: "include",
// 	body: {
// 		name: "testfruit",
// 		efmin: 0,
// 		efmax: 1000,
// 		max: 157829381,
// 		smin: 1,
// 		price: 88888888,
// 		smap: 8,
// 	},
// 	headers: {
// 		"Content-type": "application/json; charset=UTF-8",
// 	},
// });
app.post("/createProductType", authenticateSession, async (req, res) => {
	if (admins.includes(req.user.uid)) {
		let data = {
			isCrop: req.body.isCrop,
			defaultMaxScored: req.body.max,
		};
		if (req.body.isCrop) {
			data.defaultEfficiencyMin = req.body.efmin;
			data.defaultEfficiencyMax = req.body.efmax;
			data.defaultMinSeasons = req.body.smin;
			data.defaultPrice = req.body.price;
			data.defaultSeasonsMap = req.body.smap;
		}
		await getRef(firestore, "productData", req.body.name).set(data);
		return res.status(200).send("Created");
	} else {
		return res.status(401).send("Unauthorized");
	}
});

app.get("/authenticated", async (req, res) => {
	const sessionCookie = req.cookies[SESSION_COOKIE_NAME] || "";
	admin
		.auth()
		.verifySessionCookie(sessionCookie, true)
		.then((decodedClaims) => {
			res.status(200).send("Authorized");
		})
		.catch(() => res.status(401).send("Unauthorized"));
});
app.post("/createGame", authenticateSession, async (req, res) => {
	if (admins.includes(req.user.uid) || true) {
		// TODO: remove || true
		let gameData = {
			availableProducts: req.body.availableProducts,
			currentRound: 0,
			numRounds: req.body.numRounds,
			plantingTime: req.body.plantingTime,
			offeringTime: req.body.offeringTime,
			tradingTime: req.body.tradingTime,
			plotWidth: req.body.plotWidth,
			plotHeight: req.body.plotHeight,
			initialMoney: req.body.initialMoney,
			specialUpgradesEnabled: false, //req.body.specialUpgradesEnabled,
			useUpgrades: [], // req.body.useUpgrades
			roundSection: "Planting",
			season: 0,
			zeroBlendTime: false,
			initialBlenderCost: req.body.initialBlenderCost,
			blenderCostRate: req.body.blenderCostRate,
			productWeight: req.body.productWeight,
			normalizeProductUtility: req.body.normalizeProductUtility,
			productUtilityDecay: req.body.productUtilityDecay,
			moneyWeight: req.body.moneyWeight,
			moneyUtilityFunction: req.body.moneyUtilityFunction,
			initialUtility:
				req.body.moneyWeight *
				moneyUtilityFunction(
					req.body.initialMoney,
					req.body.moneyUtilityFunction
				),
		};
		let tooManyProducts = false;
		gameData.availableProducts.forEach((product) => {
			if (tooManyProducts) return;
			if (product.maxScored > 25000) {
				tooManyProducts = true;
			}
		});
		if (tooManyProducts) {
			return res
				.status(409)
				.send(
					"The maximum scored number of one of your products is too big."
				);
		}
		if (gameData.specialUpgradesEnabled) {
			gameData.specialUpgradeIdle = 10;
			gameData.minSpecialUpgradeWait = 5;
			gameData.maxSpecialUpgradeWait = 10;
			gameData.useUpgrades = await getRef(firestore, "upgradeBundles")
				.get()
				.then((snapshot) => snapshot.docs.map((doc) => doc.data()));
			gameData.specialUpgradeBundle = {
				currentBid: 10000,
				currentHolder: "",
				endTimestamp: 0,
				upgradeBundle: {},
			};
		}
		// must add checks, but for now its fine
		async function generateGameID() {
			// maybe change this function?
			let currentIds = await getRef(firestore, "games")
				.get()
				.then((snapshot) => snapshot.docs.map((doc) => doc.id));
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
		let id = await generateGameID();
		await getRef(firestore, "games", id).set(gameData);
		return res.status(200).send(id);
	} else {
		return res.status(401).send("Unauthorized");
	}
});
app.post("/joinGame", authenticateSession, async (req, res) => {
	try {
		await firestore.runTransaction(async (transaction) => {
			let gameDataDoc = getRef(firestore, "games", req.body.gameId);
			let playerRef = getRef(
				firestore,
				"games",
				req.body.gameId,
				"players",
				req.user.uid
			);
			let playersRef = getRef(
				firestore,
				"games",
				req.body.gameId,
				"players"
			);
			let [gameDataSnapshot, playersSnapshot] = await Promise.all([
				transaction.get(gameDataDoc),
				transaction.get(playersRef),
			]);
			let gameData = gameDataSnapshot.data();
			if (gameData.currentRound != 0) {
				throw new Error("Game already started.");
			}
			let players = playersSnapshot.docs.map((doc) => doc.id);
			if (players.includes(req.user.uid)) {
				throw new Error("You have already joined the game.");
			}
			let efficiencies = {};
			Object.keys(gameData.availableProducts).forEach((key) => {
				let product = gameData.availableProducts[key];
				if (!product.isCrop) return;
				efficiencies[key] =
					Math.floor(
						Math.random() *
							(product.efficiencyMax - product.efficiencyMin + 1)
					) + product.efficiencyMin;
			});
			await transaction.set(playerRef, {
				products: {},
				money: gameData.initialMoney,
				plot: {},
				seeds: {},
				nickname: req.body.nickname || req.user.uid,
				offers: {},
				cropEfficiencies: efficiencies,
				upgradeBundles: [],
				plotWidth: gameData.plotWidth,
				plotHeight: gameData.plotHeight,
				utility: gameData.initialUtility,
			});
		});
		return res.status(200).send("Game joined.");
	} catch (e) {
		return res.status(409).send(e.message || "Conflict. Please try again.");
	}
});
// TODO: FIX THIS FUNCTION BC ITS RLY JANKY
async function nextSeason(gameDataDoc) {
	await firestore.runTransaction(async (transaction) => {
		let [gameDataSnapshot, players] = await Promise.all([
			transaction.get(gameDataDoc),
			transaction.get(getRef(gameDataDoc, "players")),
		]);
		let gameData = gameDataSnapshot.data();
		players.forEach(async (doc) => {
			let player = doc.data();
			// let upgradedPlayer = applyUpgradeBundles(player, gameData);
			Object.keys(player.plot).forEach((idx) => {
				if (player.plot[idx].type != "") {
					player.plot[idx].stage++;
					if (
						player.plot[idx].stage >=
							gameData.availableProducts[player.plot[idx].type]
								.minSeasons &&
						(gameData.availableProducts[player.plot[idx].type]
							.seasonsMap &
							(1 << gameData.season)) >
							0
					) {
						if (player.plot[idx].type in player.products) {
							player.products[player.plot[idx].type] +=
								player.cropEfficiencies[player.plot[idx].type];
						} else {
							player.products[player.plot[idx].type] =
								player.cropEfficiencies[player.plot[idx].type];
						}
						delete player.plot[idx];
					}
				}
			});
			player.utility = calculateUtility(player, gameData);
			transaction.update(getRef(gameDataDoc, "players", doc.id), player);
		});
		transaction.update(gameDataDoc, {
			season: (gameData.season + 1) % 4,
		});
	});
}
async function roundLoop(gameDataDoc) {
	var gameData = (await gameDataDoc.get()).data();
	if (gameData.currentRound >= gameData.numRounds) {
		await gameDataDoc.update({
			currentRound: gameData.currentRound + 1,
		});
		return;
	}
	if (gameData.currentRound == 0) {
		var currEndTimestamp = Date.now() + gameData.plantingTime * 1000;
	} else {
		var currEndTimestamp =
			gameData.endTimestamp + gameData.plantingTime * 1000;
	}

	await gameDataDoc.update({
		currentRound: gameData.currentRound + 1,
		endTimestamp: currEndTimestamp,
	});
	setTimeout(async function () {
		nextSeason(gameDataDoc);
		currEndTimestamp += gameData.offeringTime * 1000;
		await gameDataDoc.update({
			roundSection: "Offering",
			endTimestamp: currEndTimestamp,
		});
		setTimeout(async function () {
			currEndTimestamp += gameData.tradingTime * 1000;
			await gameDataDoc.update({
				roundSection: "Trading",
				endTimestamp: currEndTimestamp,
			});
			setTimeout(async function () {
				await gameDataDoc.update({ roundSection: "Planting" });
				roundLoop(gameDataDoc);
			}, currEndTimestamp - Date.now());
		}, currEndTimestamp - Date.now());
	}, currEndTimestamp - Date.now());
}
async function checkAndAwardUpgrade(gameDataDoc, expectedBid) {
	let gameData = (await gameDataDoc.get()).data();
	if (gameData.currentRound >= gameData.numRounds) {
		return;
	}
	if (
		gameData.specialUpgradeBundle.currentBid != expectedBid //  || Date.now() < gameData.specialUpgradeBundle.endTimestamp
	) {
		return;
	}
	await gameDataDoc.update({
		specialUpgradeBundle: {
			currentBid: 10000,
			currentHolder: "",
			endTimestamp: 0,
			upgradeBundle: {},
		},
	});
	specialUpgradeLoop(gameDataDoc);
	if (gameData.specialUpgradeBundle.currentHolder != "") {
		await firestore.runTransaction(async function (transaction) {
			let playerToGive = getRef(
				gameDataDoc,
				"players",
				gameData.specialUpgradeBundle.currentHolder
			);
			let playerData = (await transaction.get(playerToGive)).data();
			let currentUpgrades = playerData.upgradeBundles;
			currentUpgrades.push(gameData.specialUpgradeBundle.upgradeBundle);
			await transaction.update(playerToGive, {
				upgradeBundles: currentUpgrades,
				money:
					playerData.money - gameData.specialUpgradeBundle.currentBid,
			});
		});
	}
}
async function specialUpgradeLoop(gameDataDoc) {
	var gameData = (await gameDataDoc.get()).data();
	setTimeout(async function () {
		let upgrade =
			gameData.useUpgrades[
				Math.floor(Math.random() * gameData.useUpgrades.length)
			];
		let specialEnd = Date.now() + gameData.specialUpgradeIdle * 1000;
		await gameDataDoc.update({
			specialUpgradeBundle: {
				currentBid: 10000,
				currentHolder: "",
				endTimestamp: specialEnd,
				upgradeBundle: upgrade,
			},
		});
		setTimeout(async function () {
			checkAndAwardUpgrade(gameDataDoc, 10000);
		}, specialEnd - Date.now());
	}, Math.random() *
		(gameData.maxSpecialUpgradeWait - gameData.minSpecialUpgradeWait) +
		gameData.minSpecialUpgradeWait);
}
app.post("/startGame", authenticateSession, async (req, res) => {
	if (admins.includes(req.user.uid) || true) {
		let gameDataDoc = await getRef(firestore, "games", req.body.gameId);
		let gameData = (await gameDataDoc.get()).data();
		if (gameData.currentRound > 0) {
			return res.status(409).send("Game already started.");
		} else {
			roundLoop(gameDataDoc);
			if (gameData.specialUpgradesEnabled) {
				specialUpgradeLoop(gameDataDoc);
			}
			return res.status(200).send("Game started.");
		}
	} else {
		return res.status(401).send("Unauthorized");
	}
});
app.post(
	"/specialUpgradeBid",
	authenticateSession,
	checkInGame,
	async (req, res) => {
		let gameDataDoc = await getRef(firestore, "games", req.body.gameId);
		let playerDoc = await getRef(gameDataDoc, "players", req.user.uid);
		try {
			await firestore.runTransaction(async function (transaction) {
				let gameData = (await transaction.get(gameDataDoc)).data();
				let playerData = (await transaction.get(playerDoc)).data();
				if (gameData.currentRound == 0) {
					throw new Error("The game has not started yet.");
				}
				if (gameData.currentRound > gameData.numRounds) {
					throw new Error("The game has finished.");
				}
				if (!gameData.specialUpgradesEnabled) {
					throw new Error("Special upgrades are not enabled.");
				}
				if (
					Date.now() >= gameData.specialUpgradeBundle.endTimestamp ||
					Object.keys(gameData.specialUpgradeBundle.upgradeBundle)
						.length == 0
				) {
					throw new Error("There is no special upgrade active.");
				}
				if (req.body.bid > playerData.money) {
					throw new Error("You do not have enough money.");
				}
				if (req.body.bid <= gameData.specialUpgradeBundle.currentBid) {
					throw new Error("You must bid more than the last bid.");
				}
				let endTimestamp =
					Date.now() + gameData.specialUpgradeIdle * 1000;
				gameDataDoc.update({
					specialUpgradeBundle: {
						currentBid: req.body.bid,
						currentHolder: req.user.uid,
						endTimestamp: endTimestamp,
						upgradeBundle:
							gameData.specialUpgradeBundle.upgradeBundle,
					},
				});
				setTimeout(function () {
					checkAndAwardUpgrade(gameDataDoc, req.body.bid);
				}, endTimestamp - Date.now());
			});
		} catch (e) {
			return res
				.status(409)
				.send(e.message || "Conflict. Please try again.");
		}
	}
);
app.post(
	"/offerProduct",
	authenticateSession,
	checkInGame,
	async (req, res) => {
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
				if (gameData.currentRound == 0) {
					throw new Error("The game has not started yet.");
				}
				if (gameData.currentRound > gameData.numRounds) {
					throw new Error("The game has ended.");
				}
				if (gameData.roundSection != "Offering") {
					throw new Error(
						"You may only do this during the offering phase."
					);
				}
				let playerData = playerDataSnapshot.data();
				playerData.offers[req.body.product] = {
					num: parseInt(req.body.num) || 0,
					pricePer: parseInt(req.body.price) || 0,
				};
				if (
					!(
						playerData.offers[req.body.product].num <=
						playerData.products[req.body.product]
					)
				) {
					throw new Error(
						"You are trying to offer more products than you have."
					);
				}
				playerDataDoc.update(playerData);
			});
			return res.status(200).send("Product offered.");
		} catch (e) {
			return res
				.status(409)
				.send(e.message || "Conflict. Please try again.");
		}
	}
);
app.post(
	"/tradeFromOffer",
	authenticateSession,
	checkInGame,
	async (req, res) => {
		try {
			await firestore.runTransaction(async (transaction) => {
				req.body.num = parseInt(req.body.num) || 0;
				if (req.body.num <= 0) {
					throw new Error("Invalid number of products to trade.");
				}
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
				if (gameData.roundSection != "Trading") {
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
				let thisUtility = calculateUtility(playerData, gameData);
				let otherUtility = calculateUtility(otherData, gameData);
				transaction.update(playerDataDoc, {
					money:
						playerData.money -
						req.body.num * otherData.offers[req.body.type].pricePer,
					[`products.${req.body.type}`]:
						uto0(playerData.products[req.body.type]) + req.body.num,
					utility: thisUtility,
				});
				transaction.update(otherDataDoc, {
					money:
						otherData.money +
						req.body.num * otherData.offers[req.body.type].pricePer,
					[`products.${req.body.type}`]:
						otherData.products[req.body.type] - req.body.num,
					[`offers.${req.body.type}.num`]:
						otherData.offers[req.body.type].num - req.body.num,
					utility: otherUtility,
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
app.post("/plantSeed", authenticateSession, checkInGame, async (req, res) => {
	// authenticateSession, checkInGame, TODO: YOU BETTER REMEMBER TO ADD THIS BACK
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
			// let upgradedPlayer = applyUpgradeBundles(playerData, gameData);
			if (gameData.currentRound == 0) {
				throw new Error("The game has not started yet.");
			}
			if (gameData.currentRound > gameData.numRounds) {
				throw new Error("The game has ended.");
			}
			if (gameData.roundSection != "Planting") {
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
				!Object.keys(gameData.availableProducts).includes(req.body.seed)
			) {
				throw new Error("That crop isn't in play.");
			}
			if (!gameData.availableProducts[req.body.seed].isCrop) {
				throw new Error("That is not a crop.");
			}
			if (
				req.body.idx < 0 ||
				req.body.idx >= playerData.plotWidth * playerData.plotHeight
			) {
				throw new Error("Planting out of range.");
			}
			// if (req.body.idx < 0 || req.body.idx >= playerData.plot.length) {
			//
			// }
			transaction.update(playerDataDoc, {
				[`seeds.${req.body.seed}`]: playerData.seeds[req.body.seed] - 1,
				[`plot.${req.body.idx}.stage`]: 0,
				[`plot.${req.body.idx}.type`]: req.body.seed,
			});
		});
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
			if (gameData.currentRound == 0) {
				throw new Error("The game has not started yet.");
			}
			let playerData = playerDataSnapshot.data();
			if (gameData.currentRound > gameData.numRounds) {
				throw new Error("The game has ended.");
			}
			if (
				!Object.keys(gameData.availableProducts).includes(req.body.seed)
			) {
				throw new Error("That crop is not in play.");
			}
			if (!gameData.availableProducts[req.body.seed].isCrop) {
				throw new Error("That is not a crop.");
			}
			// if (gameData.roundSection != "Planting") {
			// 	throw new Error(
			// 		"You may only do this during the planting phase."
			// 	);
			// }
			let totalCost = Math.floor(
				gameData.availableProducts[req.body.seed].basePrice *
					Math.pow(req.body.count, 0.9)
			);
			if (totalCost > playerData.money) {
				throw new Error("Insufficient Currency");
			}

			transaction.update(playerDataDoc, {
				money: playerData.money - totalCost,
				[`seeds.${req.body.seed}`]:
					uto0(playerData.seeds[req.body.seed]) + req.body.count,
			});
		});
		return res.status(200).send("Seed bought.");
	} catch (e) {
		return res.status(409).send(e.message || "Conflict. Please try again.");
	}
});

async function startBlend(
	gameDoc,
	blenderDoc,
	recipeCount,
	recipeData,
	playerDoc,
	zeroBlendTime // reorder
) {
	let gameData = (await gameDoc.get()).data();
	if (gameData.currentRound > gameData.numRounds) {
		return;
	}
	let endTimestamp = Date.now() + recipeData.time * recipeCount * 1000;
	// if (zeroBlendTime) {
	// 	endTimestamp = Date.now();
	// }
	blenderDoc.update({ endTimestamp: endTimestamp });
	setTimeout(function () {
		firestore.runTransaction(async (transaction) => {
			let [playerData, blenderData] = (
				await Promise.all([
					transaction.get(playerDoc),
					transaction.get(blenderDoc),
				])
			).map((snapshot) => snapshot.data());
			recipeData.results.forEach((result) => {
				playerData.products[result.name] =
					uto0(playerData.products[result.name]) +
					result.count * recipeCount;
			});
			playerData.utility = calculateUtility(playerData, gameData);
			transaction.update(playerDoc, {
				products: playerData.products,
				utility: playerData.utility,
			});
			blenderData.queuedBlends = blenderData.queuedBlends.slice(1);
			transaction.update(blenderDoc, {
				queuedBlends: blenderData.queuedBlends,
			});
			if (blenderData.queuedBlends.length > 0) {
				startBlend(
					gameDoc,
					blenderDoc,
					blenderData.queuedBlends[0].count,
					await transaction.get(
						getRef(
							firestore,
							"recipes",
							blenderData.queuedBlends[0].recipeId
						)
					),
					playerDoc,
					zeroBlendTime
				);
			}
		});
	}, endTimestamp - Date.now());
}

app.post("/queueBlend", authenticateSession, checkInGame, async (req, res) => {
	try {
		await firestore.runTransaction(async function (transaction) {
			let gameDoc = getRef(
				firestore,
				"games",
				req.body.gameId.toString()
			);
			let playerDoc = getRef(gameDoc, "players", req.user.uid.toString());
			let blenderDoc = getRef(
				playerDoc,
				"blenders",
				req.body.blenderId.toString()
			);
			let recipeDoc = getRef(
				firestore,
				"recipes",
				req.body.recipeId.toString()
			);
			let [gameData, playerData, blenderData, recipeData] = (
				await Promise.all([
					transaction.get(gameDoc),
					transaction.get(playerDoc),
					transaction.get(blenderDoc),
					transaction.get(recipeDoc),
				])
			).map((snapshot) => snapshot.data());

			// if (gameData.currentRound == 0) {
			// 	throw new Error("The game has not started yet.");
			// }
			if (gameData.currentRound > gameData.numRounds) {
				throw new Error("The game has already ended.");
			}

			if (recipeData.time * req.body.count > 1800) {
				throw new Error("That would take too long to craft.");
			}
			if (playerData.money < recipeData.cost * req.body.count) {
				throw new Error("You do not have enough money to blend that.");
			}

			playerData.money -= recipeData.cost * req.body.count;

			recipeData.ingredients.forEach((ingredient) => {
				if (
					uto0(playerData.products[ingredient.name]) <
					ingredient.count * req.body.count
				) {
					throw new Error(
						"You do not have enough ingredients to blend that."
					);
				}
				playerData.products[ingredient.name] -=
					ingredient.count * req.body.count;
			});

			blenderData.queuedBlends.push({
				recipeId: req.body.recipeId.toString(),
				count: req.body.count,
			});

			transaction.update(playerDoc, {
				products: playerData.products,
				money: playerData.money,
			});

			transaction.update(blenderDoc, {
				queuedBlends: blenderData.queuedBlends,
			});

			if (blenderData.queuedBlends.length == 1) {
				startBlend(
					gameDoc,
					blenderDoc,
					req.body.count,
					recipeData,
					playerDoc,
					gameData.zeroBlendTime
				);
			}
		});
		return res.status(200).send("Blend queued.");
	} catch (e) {
		return res.status(409).send(e.message || "Conflict. Please try again.");
	}
});

app.post("/buyBlender", authenticateSession, checkInGame, async (req, res) => {
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
			if (gameData.currentRound == 0) {
				throw new Error("The game has not started yet.");
			}
			let playerData = playerDataSnapshot.data();
			if (gameData.currentRound > gameData.numRounds) {
				throw new Error("The game has ended.");
			}
			let numBlenders = (
				await transaction.get(getRef(playerDataDoc, "blenders"))
			).docs.length;
			// TODO: create options for this
			let totalCost =
				gameData.initialBlenderCost *
				Math.pow(gameData.blenderCostRate, numBlenders);
			if (totalCost > playerData.money) {
				throw new Error("Insufficient Currency");
			}
			await transaction.set(
				getRef(playerDataDoc, "blenders", numBlenders.toString()),
				{
					endTimestamp: 0,
					queuedBlends: [],
				}
			);
			transaction.update(playerDataDoc, {
				money: playerData.money - totalCost,
			});
		});
		return res.status(200).send("Blender bought.");
	} catch (e) {
		return res.status(409).send(e.message || "Conflict. Please try again.");
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server running on https://localhost:${PORT}`);
});
