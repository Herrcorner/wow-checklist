import { NextRequest, NextResponse } from "next/server";

import { BlizzardApiError, getCached } from "@/lib/blizzardClient";
import { getSession } from "@/lib/session";

type EquipmentResponse = {
  equipped_items?: Array<{ item?: { name?: string } }>;
};

type ReputationResponse = {
  reputations?: Array<{
    faction?: { name?: string };
    standing?: { name?: string; value?: number; max?: number; tier?: number };
  }>;
};

type PvpSummaryResponse = Record<string, unknown>;

type SyncRequest = {
  region: string;
  locale: string;
  namespace: string;
  realmSlug: string;
  characterName: string;
};

export async function POST(request: NextRequest) {
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

  const payload = (await request.json()) as SyncRequest;

  const region =
    payload.region ?? process.env.BATTLENET_REGION ?? "eu";
  const locale = payload.locale ?? "en_US";
  const namespace = payload.namespace ?? "profile-classic1";
  const realmSlug = payload.realmSlug;
  const characterName = payload.characterName.toLowerCase();

  if (!realmSlug || !characterName) {
    return NextResponse.json(
      { error: "Missing character selection." },
      { status: 400 },
    );
  }

  const baseUrl = `https://${region}.battle.net/profile/wow/character/${realmSlug}/${characterName}`;

  const errors: Array<{ endpoint: string; status?: number; message: string }> = [];

  const equipment = await safeFetch<EquipmentResponse>(
    `${baseUrl}/equipment`,
    600,
    {
      accessToken,
      tokenUserId,
      namespace,
      locale,
    },
    errors,
    "equipment",
  );

  const reputations = await safeFetch<ReputationResponse>(
    `${baseUrl}/reputations`,
    900,
    {
      accessToken,
      tokenUserId,
      namespace,
      locale,
    },
    errors,
    "reputations",
  );

  const pvpSummary = await safeFetch<PvpSummaryResponse>(
    `${baseUrl}/pvp-summary`,
    900,
    {
      accessToken,
      tokenUserId,
      namespace,
      locale,
    },
    errors,
    "pvp-summary",
  );

  const equipmentItems = (equipment?.equipped_items ?? [])
    .map((item) => item.item?.name)
    .filter((name): name is string => Boolean(name));

  const reputationList = (reputations?.reputations ?? [])
    .map((rep) => ({
      name: rep.faction?.name ?? "",
      standingName: rep.standing?.name ?? "",
      standingValue: rep.standing?.value ?? 0,
      standingMax: rep.standing?.max ?? 0,
      standingTier: rep.standing?.tier ?? 0,
    }))
    .filter((rep) => rep.name);

  return NextResponse.json({
    equipmentItems,
    reputations: reputationList,
    pvpSummary: pvpSummary ?? null,
    errors,
  });
}

async function safeFetch<T>(
  url: string,
  ttlSeconds: number,
  options: {
    accessToken: string;
    tokenUserId: string;
    namespace: string;
    locale: string;
  },
  errors: Array<{ endpoint: string; status?: number; message: string }>,
  endpointName: string,
) {
  try {
    return await getCached<T>(url, ttlSeconds, options);
  } catch (error) {
    if (error instanceof BlizzardApiError) {
      errors.push({
        endpoint: endpointName,
        status: error.status,
        message: error.endpointUnavailable
          ? "Classic endpoint unavailable"
          : "Request failed",
      });
      return null;
    }
    errors.push({ endpoint: endpointName, message: "Unknown error" });
    return null;
  }
}
