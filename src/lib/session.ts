import crypto from "crypto";
import { cookies } from "next/headers";

export type SessionData = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  battletag?: string;
};

const SESSION_COOKIE = "wow_session";

const getSessionSecret = () => {
  const secret =
    process.env.SESSION_SECRET ||
    process.env.BATTLENET_CLIENT_SECRET ||
    "";
  if (!secret) {
    throw new Error("Missing SESSION_SECRET or BATTLENET_CLIENT_SECRET.");
  }
  return crypto.createHash("sha256").update(secret).digest();
};

const encrypt = (payload: SessionData) => {
  const iv = crypto.randomBytes(12);
  const key = getSessionSecret();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
};

const decrypt = (value: string) => {
  const buffer = Buffer.from(value, "base64url");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const key = getSessionSecret();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as SessionData;
};

export const getSession = async () => {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
};

export const setSession = async (data: SessionData) => {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: encrypt(data),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
};

export const clearSession = async () => {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
};
