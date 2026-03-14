import * as functions from "firebase-functions";
import axios from "axios";

// Using credentials provided by the user
const METERED_DOMAIN = "voidchatabccba.metered.live";
const METERED_SECRET_KEY = "TF73QiopcyY4INXyV2Lctlkuaw4BEke5XdKrF-ZP9_bKBCkk";

export const getIceServers = functions.https.onCall(async (data, context) => {
  // Only allow authenticated users
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Only authenticated users can fetch ICE servers."
    );
  }

  try {
    const response = await axios.get(
      `https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_SECRET_KEY}`
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching ICE servers from Metered.ca:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to fetch ICE servers."
    );
  }
});
