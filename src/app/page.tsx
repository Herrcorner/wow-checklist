"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import checklist from "@/data/checklist.json";
import characterSnapshot from "@/data/character-snapshot.json";
import type { CharacterSnapshot } from "@/lib/completion";
import { evaluateCompletionRule } from "@/lib/completion";
import type { CompletionRule, Standing } from "@/guide/types";

const SYNC_INTERVAL_HOURS = 6;

type Task = {
  id: string;
  title: string;
  type: string;
  completion?: CompletionRule;
  focusFirst?: boolean;
  why?: string;
  prerequisites?: string[];
  steps?: string[];
  unlockValue?: number;
  timeGated?: boolean;
  powerGain?: number;
};

type Checklist = {
  title: string;
  steps: Task[];
};

type Profile = {
  battletag?: string;
  id?: number;
};

type CharacterSummary = {
  id?: number;
  name: string;
  level?: number;
  realm: string;
  realmSlug: string;
  playableClass?: string;
};

type SyncResponse = {
  equipmentItems: string[];
  reputations: Array<{
    name: string;
    standingName: string;
    standingValue: number;
    standingMax: number;
    standingTier: number;
  }>;
  errors: Array<{ endpoint: string; status?: number; message: string }>;
};

const standingRank: Record<Standing, number> = {
  hated: 0,
  hostile: 1,
  unfriendly: 2,
  neutral: 3,
  friendly: 4,
  honored: 5,
  revered: 6,
  exalted: 7,
};

const normalizeKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const scoreTask = (task: Task) => {
  const unlockValue = task.unlockValue ?? 0;
  const powerGain = task.powerGain ?? 0;
  const timeGated = task.timeGated ? 2 : 0;

  return unlockValue + powerGain + timeGated;
};

const getTopologicalOrder = (tasks: Task[], done: Record<string, boolean>) => {
  const remaining = tasks.filter((task) => !done[task.id]);
  const taskMap = new Map(remaining.map((task) => [task.id, task]));
  const indegree = new Map<string, number>();
  const edges = new Map<string, string[]>();

  remaining.forEach((task) => {
    indegree.set(task.id, 0);
    edges.set(task.id, []);
  });

  remaining.forEach((task) => {
    (task.prerequisites ?? []).forEach((prereq) => {
      if (!taskMap.has(prereq)) return;

      const current = indegree.get(task.id) ?? 0;
      indegree.set(task.id, current + 1);
      edges.get(prereq)?.push(task.id);
    });
  });

  const ordered: Task[] = [];
  const ready: Task[] = remaining.filter(
    (task) => (indegree.get(task.id) ?? 0) === 0,
  );

  const sortReady = () =>
    ready.sort((a, b) => {
      const scoreDiff = scoreTask(b) - scoreTask(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.title.localeCompare(b.title);
    });

  while (ready.length > 0) {
    sortReady();
    const current = ready.shift();
    if (!current) break;

    ordered.push(current);

    edges.get(current.id)?.forEach((neighborId) => {
      const nextValue = (indegree.get(neighborId) ?? 0) - 1;
      indegree.set(neighborId, nextValue);
      if (nextValue === 0) {
        const neighbor = taskMap.get(neighborId);
        if (neighbor) ready.push(neighbor);
      }
    });
  }

  if (ordered.length !== remaining.length) {
    const fallback = remaining
      .filter(
        (task) => !ordered.find((orderedTask) => orderedTask.id === task.id),
      )
      .sort((a, b) => {
        const scoreDiff = scoreTask(b) - scoreTask(a);
        if (scoreDiff !== 0) return scoreDiff;
        return a.title.localeCompare(b.title);
      });

    ordered.push(...fallback);
  }

  return ordered;
};

const shouldCompleteEquipmentTask = (task: Task, equipmentItems: string[]) => {
  if (!task.completion) return false;
  if (task.completion.type !== "item_owned") return false;
  const targetId = normalizeKey(task.completion.itemId);
  return equipmentItems.some((item) => normalizeKey(item) === targetId);
};

const getStandingRank = (standingName: string) => {
  const key = standingName.toLowerCase() as Standing;
  return standingRank[key] ?? -1;
};

const shouldCompleteRepTask = (task: Task, reputations: SyncResponse["reputations"]) => {
  if (!task.completion) return false;

  if (task.completion.type === "rep_at_least") {
    const targetId = normalizeKey(task.completion.factionId);
    const match = reputations.find(
      (rep) => normalizeKey(rep.name) === targetId,
    );
    if (!match) return false;
    return getStandingRank(match.standingName) >= standingRank[task.completion.standing];
  }

  if (task.completion.type === "rep_at_least_any") {
    return task.completion.options.some((option) =>
      shouldCompleteRepTask(
        { ...task, completion: { type: "rep_at_least", ...option } },
        reputations,
      ),
    );
  }

  return false;
};

export default function Home() {
  const { title, steps } = checklist as Checklist;
  const tasks = steps;
  const snapshot = characterSnapshot as CharacterSnapshot;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem("wow-checklist-done");
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const [showReadyOnly, setShowReadyOnly] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const [accessToken, setAccessToken] = useState("");
  const [tokenUserId, setTokenUserId] = useState("");
  const [region, setRegion] = useState("us");
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [syncStatus, setSyncStatus] = useState("Not synced");
  const [syncErrors, setSyncErrors] = useState<SyncResponse["errors"]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncInFlight = useRef(false);

  const setOverridesAndPersist = useCallback(
    (next: Record<string, boolean>) => {
      setManualOverrides(next);
      if (typeof window === "undefined") return;
      localStorage.setItem("wow-checklist-done", JSON.stringify(next));
    },
    [],
  );

  const hasOverride = useCallback(
    (id: string) => Object.prototype.hasOwnProperty.call(manualOverrides, id),
    [manualOverrides],
  );

  const setManualOverride = useCallback(
    (id: string, value: boolean, autoCompleted: boolean) => {
      const next = { ...manualOverrides };
      if (value === autoCompleted) {
        delete next[id];
      } else {
        next[id] = value;
      }
      setOverridesAndPersist(next);
    },
    [manualOverrides, setOverridesAndPersist],
  );

  const completionById = useMemo(
    () =>
      tasks.reduce(
        (acc, task) => {
          acc[task.id] = evaluateCompletionRule(task.completion, snapshot);
          return acc;
        },
        {} as Record<string, ReturnType<typeof evaluateCompletionRule>>,
      ),
    [snapshot, tasks],
  );

  const done = useMemo(() => {
    return tasks.reduce(
      (acc, task) => {
        const autoCompleted = completionById[task.id]?.completed ?? false;
        acc[task.id] = hasOverride(task.id)
          ? manualOverrides[task.id]
          : autoCompleted;
        return acc;
      },
      {} as Record<string, boolean>,
    );
  }, [completionById, hasOverride, manualOverrides, tasks]);

  const isReady = useCallback(
    (task: Task) => (task.prerequisites ?? []).every((p) => done[p] === true),
    [done],
  );

  const nextTasks = useMemo(
    () => getTopologicalOrder(tasks, done).slice(0, 5),
    [done, tasks],
  );

  const completedCount = useMemo(
    () => tasks.filter((task) => done[task.id]).length,
    [done, tasks],
  );

  const completionByPercent = useMemo(() => {
    if (!tasks.length) return 0;
    return Math.round((completedCount / tasks.length) * 100);
  }, [completedCount, tasks.length]);

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const completed = done[task.id] ?? false;
        if (!showCompleted && completed) return false;
        if (showReadyOnly && !isReady(task)) return false;
        return true;
      }),
    [done, isReady, showCompleted, showReadyOnly, tasks],
  );

  const selectedCharacter = useMemo(
    () => characters.find((character) => String(character.id ?? "") === selectedCharacterId),
    [characters, selectedCharacterId],
  );

  const toggle = useCallback(
    (id: string, autoCompleted: boolean) => {
      const current = hasOverride(id) ? manualOverrides[id] : autoCompleted;
      setManualOverride(id, !current, autoCompleted);
    },
    [hasOverride, manualOverrides, setManualOverride],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedToken = localStorage.getItem("blizzardAccessToken");
    const savedUserId = localStorage.getItem("blizzardTokenUserId");
    const savedRegion = localStorage.getItem("blizzardRegion");
    const savedCharacterId = localStorage.getItem("blizzardCharacterId");
    const savedLastSync = localStorage.getItem("blizzardLastSync");
    if (savedToken) setAccessToken(savedToken);
    if (savedUserId) setTokenUserId(savedUserId);
    if (savedRegion) setRegion(savedRegion);
    if (savedCharacterId) setSelectedCharacterId(savedCharacterId);
    if (savedLastSync) setLastSync(Number(savedLastSync));
  }, []);

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

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      try {
        const response = await fetch("/api/profile");
        if (!response.ok) {
          if (response.status !== 401) {
            setProfileError("Unable to load profile.");
          }
          return;
        }
        const payload = (await response.json()) as Profile;
        if (!active) return;
        setProfile(payload);
        if (payload.battletag && !tokenUserId) {
          setTokenUserId(payload.battletag);
        }
      } catch {
        if (active) setProfileError("Unable to load profile.");
      }
    };
    void loadProfile();
    return () => {
      active = false;
    };
  }, [tokenUserId]);

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
        const updated = { ...manualOverrides };

        tasks.forEach((task) => {
          if (shouldCompleteRepTask(task, payload.reputations)) {
            updated[task.id] = true;
          }
          if (shouldCompleteEquipmentTask(task, payload.equipmentItems)) {
            updated[task.id] = true;
          }
        });

        setOverridesAndPersist(updated);
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
      manualOverrides,
      region,
      selectedCharacter,
      setOverridesAndPersist,
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

  const loadCharacters = useCallback(async () => {
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
  }, [accessToken, region, selectedCharacterId, tokenUserId]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-sm uppercase tracking-widest text-amber-300/70">
            The Burning Crusade Checklist
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-amber-100">
            {title}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-amber-100/70">
            Manual tracking until auto-sync arrives. Check tasks, follow the
            “next up” focus list, and hide what’s already done.
          </p>
        </div>

        <div className="rounded-xl border border-amber-400/30 bg-slate-950/70 px-4 py-3 text-sm text-amber-100/80">
          {profile ? (
            <div className="space-y-2">
              <p className="font-semibold text-amber-200">
                Logged in as {profile.battletag ?? "Adventurer"}
              </p>
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="rounded-md border border-amber-300/40 px-3 py-1 text-xs uppercase tracking-wide text-amber-100"
                >
                  Log out
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-2">
              <p>Battle.net login enables profile-aware features.</p>
              <a
                href="/api/auth/login"
                className="inline-flex items-center justify-center rounded-md bg-amber-400/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-900"
              >
                Log in with Battle.net
              </a>
              {profileError ? (
                <p className="text-xs text-red-300">{profileError}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <section className="mt-8 rounded-xl border border-amber-500/30 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-amber-100/70">
              Overall completion: {completedCount}/{tasks.length}
            </p>
            <div className="mt-2 h-2 w-64 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-amber-400"
                style={{ width: `${completionByPercent}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-amber-100/70">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showReadyOnly}
                onChange={(event) => setShowReadyOnly(event.target.checked)}
              />
              Show only ready tasks
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => setShowCompleted(event.target.checked)}
              />
              Show completed
            </label>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-amber-500/30 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-amber-100">Next 5 tasks</h2>
          <p className="text-xs text-amber-100/70">
            Sorted by prerequisites + unlock, time-gating, and power gain.
          </p>
        </div>
        <ul className="mt-3 space-y-3">
          {nextTasks.map((task) => {
            const ready = isReady(task);
            const score = scoreTask(task);

            return (
              <li
                key={task.id}
                className="rounded-md border border-amber-500/20 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={ready ? "" : "opacity-60"}>
                    {task.title}
                  </span>
                  <span className="text-xs uppercase tracking-wide opacity-60">
                    score {score}
                  </span>
                </div>
                {!ready && (
                  <p className="mt-1 text-xs opacity-60">
                    Locked until prerequisites are completed.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-6 rounded-lg border border-amber-500/30 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-amber-100">Blizzard Sync</h2>
            <p className="text-sm text-amber-100/70">
              Paste a Battle.net access token to sync Classic character data.
            </p>
          </div>
          <button
            type="button"
            className="rounded border border-amber-400/30 px-3 py-1 text-sm text-amber-100"
            onClick={() => runSync("manual")}
            disabled={syncing || !accessToken || !selectedCharacter}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-amber-100/80">
            Access token
            <input
              className="rounded border border-amber-400/30 bg-slate-950/80 px-2 py-1 text-amber-100"
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder="Paste your Battle.net access token"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-amber-100/80">
            Token user id (for rate limits)
            <input
              className="rounded border border-amber-400/30 bg-slate-950/80 px-2 py-1 text-amber-100"
              value={tokenUserId}
              onChange={(event) => setTokenUserId(event.target.value)}
              placeholder="e.g. battle-tag or user id"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-amber-100/80">
            Region
            <select
              className="rounded border border-amber-400/30 bg-slate-950/80 px-2 py-1 text-amber-100"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            >
              <option value="us">US</option>
              <option value="eu">EU</option>
              <option value="kr">KR</option>
              <option value="tw">TW</option>
            </select>
          </label>
          <div className="flex flex-col gap-2 text-sm text-amber-100/80">
            <button
              type="button"
              className="rounded border border-amber-400/30 px-3 py-1"
              onClick={loadCharacters}
              disabled={!accessToken}
            >
              Load characters
            </button>
            <span className="text-xs opacity-70">{syncStatus}</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-amber-100/80">
            Selected character
            <select
              className="rounded border border-amber-400/30 bg-slate-950/80 px-2 py-1 text-amber-100"
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
          <div className="text-sm text-amber-100/80">
            <p className="font-medium">Last sync</p>
            <p className="text-xs opacity-70">
              {lastSync ? new Date(lastSync).toLocaleString() : "Not synced yet"}
            </p>
            {syncErrors.length ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-amber-300">
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

      <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          {visibleTasks.map((task) => {
            const completed = done[task.id] ?? false;
            const ready = isReady(task);
            const completionMeta = completionById[task.id];
            const autoCompleted = completionMeta?.completed ?? false;
            const needsManualConfirm = completionMeta?.needsManualConfirm ?? false;

            return (
              <div
                key={task.id}
                className={`rounded-lg border border-amber-400/20 bg-slate-950/60 p-4 ${
                  !ready ? "opacity-70" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    className={`mt-1 h-5 w-5 rounded border border-amber-400/40 ${
                      completed ? "bg-amber-300/80" : ""
                    }`}
                    onClick={() => toggle(task.id, autoCompleted)}
                    aria-label={`Mark ${task.title} complete`}
                  />

                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium text-amber-100">{task.title}</h2>

                      <span className="rounded bg-amber-100/10 px-2 py-0.5 text-xs text-amber-100/80">
                        {task.type}
                      </span>

                      {task.focusFirst && (
                        <span className="rounded bg-amber-100/10 px-2 py-0.5 text-xs text-amber-100/80">
                          focus first
                        </span>
                      )}

                      {!ready && (
                        <span className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-200">
                          🔒 Locked — finish prereqs
                        </span>
                      )}

                      {task.completion && (
                        <span className="rounded bg-amber-100/10 px-2 py-0.5 text-xs text-amber-100/80">
                          auto
                        </span>
                      )}

                      {hasOverride(task.id) && (
                        <span className="rounded bg-amber-100/10 px-2 py-0.5 text-xs text-amber-100/80">
                          manual override
                        </span>
                      )}
                    </div>

                    {task.why ? (
                      <p className="mt-2 text-sm text-amber-100/70">
                        {task.why}
                      </p>
                    ) : null}

                    {task.steps?.length ? (
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-100/70">
                        {task.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ul>
                    ) : null}

                    {needsManualConfirm && !completed ? (
                      <button
                        type="button"
                        className="mt-3 rounded border border-amber-400/40 px-2 py-1 text-xs text-amber-100"
                        onClick={() => setManualOverride(task.id, true, autoCompleted)}
                      >
                        I have it (manual confirm)
                      </button>
                    ) : null}

                    {task.prerequisites?.length ? (
                      <p className="mt-2 text-xs text-amber-100/60">
                        Prereqs: {task.prerequisites.join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-amber-400/30 bg-slate-950/70 p-4">
            <h2 className="text-lg font-semibold text-amber-100">
              Next up (Top 5)
            </h2>
            <p className="mt-1 text-xs text-amber-100/70">
              Ordered by prerequisite readiness + impact.
            </p>
            <ol className="mt-4 space-y-3 text-sm text-amber-100/80">
              {nextTasks.length ? (
                nextTasks.map((task) => (
                  <li key={task.id} className="rounded-md bg-slate-900/80 p-3">
                    <p className="font-semibold text-amber-200">
                      {task.title}
                    </p>
                    {task.why ? (
                      <p className="text-xs text-amber-100/70">{task.why}</p>
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="text-amber-100/60">
                  You’re caught up! Toggle “Show completed” to review.
                </li>
              )}
            </ol>
          </div>

          <div className="rounded-xl border border-amber-400/30 bg-slate-950/70 p-4 text-xs text-amber-100/70">
            <p className="font-semibold text-amber-200">
              Focus logic (manual)
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Big upgrades score highest (e.g., trinkets, set bonuses).</li>
              <li>Unlocks push future content (heroics, attunements).</li>
              <li>Time gates help you plan weekly lockouts.</li>
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}
