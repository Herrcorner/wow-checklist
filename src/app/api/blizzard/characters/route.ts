import { NextRequest, NextResponse } from "next/server";

import { BlizzardApiError, getCached } from "@/lib/blizzardClient";
import { getSession } from "@/lib/session";

type BlizzardCharacter = {
  id?: number;
  name: string;
  level?: number;
  realm?: { name?: string; slug?: string };
  playable_class?: { name?: string };
};

type BlizzardAccountProfile = {
  wow_accounts?: Array<{ characters?: BlizzardCharacter[] }>;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region =
    searchParams.get("region") ?? process.env.BATTLENET_REGION ?? "eu";
  const locale = searchParams.get("locale") ?? "en_US";
  const namespace = searchParams.get("namespace") ?? "profile-classic1";

  const session = await getSession();
  const accessToken = session?.accessToken;
  const tokenUserId =
    request.headers.get("x-token-user-id") ??
    session?.battletag ??
    "anonymous";

  if (!accessToken) {
    return NextResponse.json(
      { error: "Missing Blizzard access token." },
      { status: 401 },
    );
  }

  const profileUrl = `https://${region}.battle.net/profile/user/wow`;

  try {
    const profile = await getCached<BlizzardAccountProfile>(profileUrl, 300, {
      namespace,
      locale,
      accessToken,
      tokenUserId,
    });

    const characters = (profile.wow_accounts ?? [])
      .flatMap((account) => account.characters ?? [])
      .map((character) => ({
        id: character.id,
        name: character.name,
        level: character.level,
        realm: character.realm?.name ?? "Unknown",
        realmSlug: character.realm?.slug ?? "unknown",
        playableClass: character.playable_class?.name ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ characters });
  } catch (error) {
    const status = error instanceof BlizzardApiError ? error.status : 500;
    return NextResponse.json(
      { error: "Failed to load characters." },
      { status },
    );
  }
}
