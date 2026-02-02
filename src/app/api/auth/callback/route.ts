import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBattlenetConfig } from "@/lib/battlenet";
import { setSession } from "@/lib/session";

const STATE_COOKIE = "wow_oauth_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?login=missing", request.url));
  }

  const store = await cookies();
  const savedState = store.get(STATE_COOKIE)?.value;
  store.set({
    name: STATE_COOKIE,
    value: "",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });

  if (!savedState || savedState !== state) {
    return NextResponse.redirect(new URL("/?login=state", request.url));
  }

  const { clientId, clientSecret, redirectUri, oauthBase } =
    getBattlenetConfig(request.url);

  const tokenResponse = await fetch(`${oauthBase}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${clientId}:${clientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(new URL("/?login=token", request.url));
  }

  const tokenJson = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const expiresAt = Date.now() + tokenJson.expires_in * 1000;

  const userInfoResponse = await fetch(`${oauthBase}/userinfo`, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
    },
  });

  const userInfo = userInfoResponse.ok
    ? await userInfoResponse.json()
    : null;

  await setSession({
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresAt,
    battletag: userInfo?.battletag,
  });

  return NextResponse.redirect(new URL("/?login=success", request.url));
}
