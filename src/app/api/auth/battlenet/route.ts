import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateOauthState, getBattlenetConfig } from "@/lib/battlenet";

const STATE_COOKIE = "wow_oauth_state";

export async function GET(request: Request) {
  let clientId: string;
  let redirectUri: string;
  let oauthBase: string;

  try {
    ({ clientId, redirectUri, oauthBase } = getBattlenetConfig(request.url));
  } catch (error) {
    console.error("Battle.net OAuth config error", error);
    return NextResponse.json(
      { error: "Battle.net login is not configured." },
      { status: 500 },
    );
  }

  const state = generateOauthState();
  const store = await cookies();

  store.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
    state,
  });

  return NextResponse.redirect(`${oauthBase}/authorize?${params.toString()}`);
}
