"use client";

import { useEffect, useMemo, useState } from "react";
import checklist from "@/data/checklist.json";
import characterSnapshot from "@/data/character-snapshot.json";
import { evaluateCompletionRule } from "@/lib/completion";
import { CompletionRule } from "@/guide/types";

type Task = {
  id: string;
  title: string;
  type: string;
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
  tasks: Task[];
};

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
      .filter((task) => !ordered.find((orderedTask) => orderedTask.id === task.id))
      .sort((a, b) => {
        const scoreDiff = scoreTask(b) - scoreTask(a);
        if (scoreDiff !== 0) return scoreDiff;
        return a.title.localeCompare(b.title);
      });

    ordered.push(...fallback);
  }

  return ordered;
};

export default function Home() {
  const { title, steps } = checklist as Checklist;
  const allTasks = getAllTasks(steps);

  // ✅ Load from localStorage without useEffect (fixes react-hooks/set-state-in-effect)
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem("wow-checklist-done");
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const [hideCompleted, setHideCompleted] = useState(false);

  const setOverridesAndPersist = (next: Record<string, boolean>) => {
    setManualOverrides(next);
    localStorage.setItem("done", JSON.stringify(next));
  };

  const hasOverride = (id: string) =>
    Object.prototype.hasOwnProperty.call(manualOverrides, id);

  const setManualOverride = (id: string, value: boolean, autoCompleted: boolean) => {
    const next = { ...manualOverrides };
    if (value === autoCompleted) {
      delete next[id];
    } else {
      next[id] = value;
    }
    setOverridesAndPersist(next);
  };

  const toggle = (id: string, autoCompleted: boolean) => {
    const current = hasOverride(id) ? manualOverrides[id] : autoCompleted;
    setManualOverride(id, !current, autoCompleted);
  };

  const completionById = tasks.reduce(
    (acc, task) => {
      acc[task.id] = evaluateCompletionRule(task.completion, characterSnapshot);
      return acc;
    },
    {} as Record<string, ReturnType<typeof evaluateCompletionRule>>,
  );

  const isCompleted = (taskId: string) => {
    const autoCompleted = completionById[taskId]?.completed ?? false;
    return hasOverride(taskId) ? manualOverrides[taskId] : autoCompleted;
  };

  const isReady = (t: Task) =>
    (t.prerequisites ?? []).every((p) => isCompleted(p) === true);

  // ✅ No useMemo => fixes React Compiler preserve-manual-memoization + deps warning
  const baseTasks = hideCompleted ? tasks.filter((t) => !done[t.id]) : tasks;

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
              Overall completion: {completedCount}/{allTasks.length}
            </p>
            <div className="mt-2 h-2 w-64 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-amber-400"
                style={{ width: `${overallPercent}%` }}
              />
            </div>
          </div>

  const completedCount = tasks.filter((t) => done[t.id]).length;
  const nextTasks = getTopologicalOrder(tasks, done).slice(0, 5);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>

      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-sm opacity-80">
          Completed: {completedCount}/{tasks.length}
        </p>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showReadyOnly}
              onChange={(e) => setShowReadyOnly(e.target.checked)}
            />
            Show only ready tasks
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />
            Show completed
          </label>
        </div>
      </div>

      <section className="mt-6 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Next 5 tasks</h2>
          <p className="text-xs opacity-70">
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
                className="rounded-md border border-dashed px-3 py-2"
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

      <div className="mt-6 space-y-4">
        {visibleTasks.map((t) => {
          const completed = isCompleted(t.id);
          const ready = isReady(t);
          const completionMeta = completionById[t.id];
          const autoCompleted = completionMeta?.completed ?? false;
          const needsManualConfirm = completionMeta?.needsManualConfirm ?? false;

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
                  onClick={() => toggle(t.id, autoCompleted)}
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
                      <span className="rounded border border-slate-300 bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        🔒 Locked — finish prereqs
                      </span>
                    )}

                    {t.completion && (
                      <span className="rounded bg-black/5 px-2 py-0.5 text-xs">
                        auto
                      </span>
                    )}

                    {hasOverride(t.id) && (
                      <span className="rounded bg-black/5 px-2 py-0.5 text-xs">
                        manual override
                      </span>
                    )}
                  </div>
                </summary>

                <div className="mt-4 space-y-3">
                  {stepTasks.map((task) => {
                    const completed = !!done[task.id];
                    const ready = isTaskReady(task, done);
                    const impactScore = getImpactScore(task);

                  {needsManualConfirm && !completed ? (
                    <button
                      type="button"
                      className="mt-2 rounded border px-2 py-1 text-xs"
                      onClick={() => setManualOverride(t.id, true, autoCompleted)}
                    >
                      I have it (manual confirm)
                    </button>
                  ) : null}

                  {t.prerequisites?.length ? (
                    <p className="mt-2 text-xs opacity-70">
                      Prereqs: {t.prerequisites.join(", ")}
                    </p>
                  ) : null}

                  {stepTasks.length === 0 ? (
                    <p className="text-sm text-amber-100/60">
                      All tasks complete for this step.
                    </p>
                  ) : null}
                </div>
              </details>
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
              {nextUp.length ? (
                nextUp.map((task) => (
                  <li key={task.id} className="rounded-md bg-slate-900/80 p-3">
                    <p className="font-semibold text-amber-200">
                      {task.title}
                    </p>
                    <p className="text-xs text-amber-100/70">{task.how}</p>
                  </li>
                ))
              ) : (
                <li className="text-amber-100/60">
                  You’re caught up! Toggle “Hide completed” to review.
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
