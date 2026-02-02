import crypto from "crypto";

const getBaseUrl = (requestUrl: string) => {
  const envBase = process.env.APP_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
};

export const getBattlenetConfig = (requestUrl: string) => {
  const clientId = process.env.BATTLENET_CLIENT_ID;
  const clientSecret = process.env.BATTLENET_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing Battle.net OAuth env vars.");
  }

  const region = process.env.BATTLENET_REGION || "eu";
  const baseUrl = getBaseUrl(requestUrl);
  const redirectUri = `${baseUrl}/api/auth/battlenet/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    region,
    oauthBase: `https://${region}.battle.net/oauth`,
  };
};

export const generateOauthState = () => crypto.randomBytes(16).toString("hex");
