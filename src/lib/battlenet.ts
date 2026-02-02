import crypto from "crypto";

const defaultOauthBase = "https://oauth.battle.net";

const getBaseUrl = (requestUrl: string) => {
  const envBase = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
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

  const baseUrl = getBaseUrl(requestUrl);
  const redirectUri =
    process.env.BATTLENET_REDIRECT_URI ||
    `${baseUrl}/api/auth/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    oauthBase: process.env.BATTLENET_OAUTH_BASE || defaultOauthBase,
  };
};

export const generateOauthState = () => crypto.randomBytes(16).toString("hex");
