import { NextResponse } from "next/server";
import { getBattlenetConfig } from "@/lib/battlenet";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { oauthBase } = getBattlenetConfig(request.url);
  const response = await fetch(`${oauthBase}/userinfo`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "blizzard_request_failed" },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as {
    id?: number;
    battletag?: string;
  };

  return NextResponse.json({
    id: payload.id ?? null,
    battletag: payload.battletag ?? null,
  });
}
