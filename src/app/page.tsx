"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import checklist from "@/data/checklist.json";

type Task = {
  id: string;
  title: string;
  type: string;
  focusFirst?: boolean;
  why?: string;
  prerequisites?: string[];
  steps?: string[];
};

type Checklist = {
  title: string;
  tasks: Task[];
};

type CharacterSummary = {
  id?: number;
  name: string;
  level?: number;
  realm: string;
  realmSlug: string;
  playableClass?: string;
};

type ReputationEntry = {
  name: string;
  standingName: string;
  standingTier: number;
};

type SyncResponse = {
  equipmentItems: string[];
  reputations: ReputationEntry[];
  pvpSummary: Record<string, unknown> | null;
  errors: Array<{ endpoint: string; status?: number; message: string }>;
};

const STANDING_NAME_TO_TIER: Record<string, number> = {
  hated: 1,
  hostile: 2,
  unfriendly: 3,
  neutral: 4,
  friendly: 5,
  honored: 6,
  revered: 7,
  exalted: 8,
};

const SYNC_INTERVAL_HOURS = 6;

const getStoredValue = (key: string, fallback = "") => {
  if (typeof window === "undefined") return fallback;
  const saved = localStorage.getItem(key);
  return saved ?? fallback;
};

const normalize = (value: string) => value.trim().toLowerCase();

const parseRepRequirement = (title: string) => {
  const match = title.match(
    /(get|reach)\s+(.+?)\s+to\s+(friendly|honored|revered|exalted)/i,
  );
  if (!match) return null;
  const factionPart = match[2] ?? "";
  const requirement = match[3] ?? "";
  const factions = factionPart
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const requiredTier = STANDING_NAME_TO_TIER[normalize(requirement)] ?? 0;
  return { factions, requiredTier };
};

const buildReputationMap = (reputations: ReputationEntry[]) => {
  const map = new Map<string, number>();
  reputations.forEach((rep) => {
    const tier =
      rep.standingTier ||
      STANDING_NAME_TO_TIER[normalize(rep.standingName)] ||
      0;
    map.set(normalize(rep.name), tier);
  });
  return map;
};

const shouldCompleteRepTask = (
  task: Task,
  reputations: ReputationEntry[],
) => {
  if (task.type !== "reputation") return false;
  const requirement = parseRepRequirement(task.title);
  if (!requirement) return false;
  const repMap = buildReputationMap(reputations);
  return requirement.factions.some((faction) => {
    const tier = repMap.get(normalize(faction)) ?? 0;
    return tier >= requirement.requiredTier;
  });
};

const shouldCompleteEquipmentTask = (
  task: Task,
  equipmentItems: string[],
) => {
  if (task.type === "reputation") return false;
  const title = normalize(task.title);
  return equipmentItems.some((item) => title.includes(normalize(item)));
};

export default function Home() {
  const { title, tasks } = checklist as Checklist;

  // ✅ Load from localStorage without useEffect (fixes react-hooks/set-state-in-effect)
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem("done");
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const [showCompleted, setShowCompleted] = useState(false);
  const [accessToken, setAccessToken] = useState(() =>
    getStoredValue("blizzardAccessToken"),
  );
  const [tokenUserId, setTokenUserId] = useState(() =>
    getStoredValue("blizzardTokenUserId"),
  );
  const [region, setRegion] = useState(() =>
    getStoredValue("blizzardRegion", "us"),
  );
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState(() =>
    getStoredValue("blizzardCharacterId"),
  );
  const [lastSync, setLastSync] = useState(() => {
    const saved = getStoredValue("blizzardLastSync");
    return saved ? Number(saved) : null;
  });
  const [syncStatus, setSyncStatus] = useState("Idle");
  const [syncErrors, setSyncErrors] = useState<SyncResponse["errors"]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncInFlight = useRef(false);

  const setDoneAndPersist = useCallback((next: Record<string, boolean>) => {
    setDone(next);
    localStorage.setItem("done", JSON.stringify(next));
  }, []);

  const toggle = (id: string) => {
    const next = { ...done, [id]: !done[id] };
    setDoneAndPersist(next);
  };

  const isReady = (t: Task) =>
    (t.prerequisites ?? []).every((p) => done[p] === true);

  // ✅ No useMemo => fixes React Compiler preserve-manual-memoization + deps warning
  const baseTasks = showCompleted ? tasks : tasks.filter((t) => !done[t.id]);

  const visibleTasks = [...baseTasks].sort((a, b) => {
    // Focus-first at the top
    const af = a.focusFirst ? 1 : 0;
    const bf = b.focusFirst ? 1 : 0;
    if (af !== bf) return bf - af;

    // Ready tasks before locked tasks
    const ar = isReady(a) ? 1 : 0;
    const br = isReady(b) ? 1 : 0;
    if (ar !== br) return br - ar;

    // Stable fallback
    return a.title.localeCompare(b.title);
  });

  const completedCount = tasks.filter((t) => done[t.id]).length;

  const selectedCharacter = characters.find(
    (character) => String(character.id ?? "") === selectedCharacterId,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("blizzardAccessToken", accessToken);
  }, [accessToken]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("blizzardTokenUserId", tokenUserId);
  }, [tokenUserId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("blizzardRegion", region);
  }, [region]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("blizzardCharacterId", selectedCharacterId);
  }, [selectedCharacterId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (lastSync) {
      localStorage.setItem("blizzardLastSync", String(lastSync));
    }
  }, [lastSync]);

  const runSync = useCallback(
    async (trigger: "manual" | "scheduled") => {
      if (!accessToken || !selectedCharacter) return;
      if (syncInFlight.current) return;

      syncInFlight.current = true;
      setSyncing(true);
      setSyncErrors([]);
      setSyncStatus(trigger === "manual" ? "Syncing…" : "Auto-syncing…");

      try {
        const response = await fetch("/api/blizzard/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "x-token-user-id": tokenUserId,
          },
          body: JSON.stringify({
            region,
            locale: "en_US",
            namespace: "profile-classic1",
            realmSlug: selectedCharacter.realmSlug,
            characterName: selectedCharacter.name,
          }),
        });

        if (!response.ok) {
          setSyncStatus("Sync failed");
          return;
        }

        const payload = (await response.json()) as SyncResponse;
        const updated = { ...done };

        tasks.forEach((task) => {
          if (shouldCompleteRepTask(task, payload.reputations)) {
            updated[task.id] = true;
          }
          if (shouldCompleteEquipmentTask(task, payload.equipmentItems)) {
            updated[task.id] = true;
          }
        });

        setDoneAndPersist(updated);
        setSyncErrors(payload.errors);
        setLastSync(Date.now());
        setSyncStatus(payload.errors.length ? "Synced with warnings" : "Synced");
      } catch {
        setSyncStatus("Sync failed");
      } finally {
        syncInFlight.current = false;
        setSyncing(false);
      }
    },
    [
      accessToken,
      done,
      region,
      selectedCharacter,
      setDoneAndPersist,
      tasks,
      tokenUserId,
    ],
  );

  useEffect(() => {
    if (!accessToken || !selectedCharacter) return;
    if (!lastSync) return;
    const elapsedMs = Date.now() - lastSync;
    if (elapsedMs < SYNC_INTERVAL_HOURS * 60 * 60 * 1000) return;
    void runSync("scheduled");
  }, [accessToken, lastSync, runSync, selectedCharacter]);

  const loadCharacters = async () => {
    if (!accessToken) return;
    setSyncStatus("Loading characters…");
    try {
      const response = await fetch(
        `/api/blizzard/characters?region=${region}&locale=en_US&namespace=profile-classic1`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "x-token-user-id": tokenUserId,
          },
        },
      );
      if (!response.ok) {
        setSyncStatus("Character load failed");
        return;
      }
      const payload = (await response.json()) as {
        characters: CharacterSummary[];
      };
      setCharacters(payload.characters);
      if (payload.characters.length && !selectedCharacterId) {
        setSelectedCharacterId(String(payload.characters[0]?.id ?? ""));
      }
      setSyncStatus("Characters loaded");
    } catch {
      setSyncStatus("Character load failed");
    }
  };

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>

      <section className="mt-6 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Blizzard Sync</h2>
            <p className="text-sm opacity-80">
              Paste a Battle.net access token to sync Classic character data.
            </p>
          </div>
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => runSync("manual")}
            disabled={syncing || !accessToken || !selectedCharacter}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Access token
            <input
              className="rounded border px-2 py-1"
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder="Paste your Battle.net access token"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Token user id (for rate limits)
            <input
              className="rounded border px-2 py-1"
              value={tokenUserId}
              onChange={(event) => setTokenUserId(event.target.value)}
              placeholder="e.g. battle-tag or user id"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Region
            <select
              className="rounded border px-2 py-1"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            >
              <option value="us">US</option>
              <option value="eu">EU</option>
              <option value="kr">KR</option>
              <option value="tw">TW</option>
            </select>
          </label>
          <div className="flex flex-col gap-2 text-sm">
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={loadCharacters}
              disabled={!accessToken}
            >
              Load characters
            </button>
            <span className="text-xs opacity-70">{syncStatus}</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Selected character
            <select
              className="rounded border px-2 py-1"
              value={selectedCharacterId}
              onChange={(event) => setSelectedCharacterId(event.target.value)}
            >
              <option value="">Select a character</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name} ({character.realm})
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <p className="font-medium">Last sync</p>
            <p className="text-xs opacity-70">
              {lastSync
                ? new Date(lastSync).toLocaleString()
                : "Not synced yet"}
            </p>
            {syncErrors.length ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
                {syncErrors.map((error) => (
                  <li key={error.endpoint}>
                    {error.endpoint}: {error.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-sm opacity-80">
          Completed: {completedCount}/{tasks.length}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
          />
          Show completed
        </label>
      </div>

      <div className="mt-6 space-y-4">
        {visibleTasks.map((t) => {
          const completed = !!done[t.id];
          const ready = isReady(t);

          return (
            <div
              key={t.id}
              className={`rounded-lg border p-4 ${!ready ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  className={`mt-1 h-5 w-5 rounded border ${
                    completed ? "bg-black" : ""
                  }`}
                  onClick={() => toggle(t.id)}
                  aria-label={`Mark ${t.title} complete`}
                />

                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{t.title}</h2>

                    <span className="rounded bg-black/5 px-2 py-0.5 text-xs">
                      {t.type}
                    </span>

                    {t.focusFirst && (
                      <span className="rounded bg-black/5 px-2 py-0.5 text-xs">
                        focus first
                      </span>
                    )}

                    {!ready && (
                      <span className="rounded bg-black/5 px-2 py-0.5 text-xs">
                        locked (finish prereqs)
                      </span>
                    )}
                  </div>

                  {t.why && <p className="mt-1 text-sm opacity-80">{t.why}</p>}

                  {t.prerequisites?.length ? (
                    <p className="mt-2 text-xs opacity-70">
                      Prereqs: {t.prerequisites.join(", ")}
                    </p>
                  ) : null}

                  {t.steps?.length ? (
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      {t.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
