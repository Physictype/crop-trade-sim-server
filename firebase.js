import firebaseAdmin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json" with { type: "json" };

export const admin = firebaseAdmin.initializeApp({
	credential: firebaseAdmin.credential.cert(serviceAccount),
});
