"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIceServers = void 0;
const functions = require("firebase-functions");
const axios_1 = require("axios");
// Using credentials provided by the user
const METERED_DOMAIN = "voidchatabccba.metered.live";
const METERED_SECRET_KEY = "TF73QiopcyY4INXyV2Lctlkuaw4BEke5XdKrF-ZP9_bKBCkk";
exports.getIceServers = functions.https.onCall(async (data, context) => {
    // Only allow authenticated users
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Only authenticated users can fetch ICE servers.");
    }
    try {
        const response = await axios_1.default.get(`https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_SECRET_KEY}`);
        return response.data;
    }
    catch (error) {
        console.error("Error fetching ICE servers from Metered.ca:", error);
        throw new functions.https.HttpsError("internal", "Failed to fetch ICE servers.");
    }
});
//# sourceMappingURL=index.js.map