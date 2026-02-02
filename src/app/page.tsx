"use client";

import { useState } from "react";
import checklist from "@/data/checklist.json";

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

  const [hideCompleted, setHideCompleted] = useState(false);

  const setDoneAndPersist = (next: Record<string, boolean>) => {
    setDone(next);
    localStorage.setItem("done", JSON.stringify(next));
  };

  const toggle = (id: string) => {
    const next = { ...done, [id]: !done[id] };
    setDoneAndPersist(next);
  };

  const isReady = (t: Task) =>
    (t.prerequisites ?? []).every((p) => done[p] === true);

  // ✅ No useMemo => fixes React Compiler preserve-manual-memoization + deps warning
  const baseTasks = hideCompleted ? tasks.filter((t) => !done[t.id]) : tasks;

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
  const nextTasks = getTopologicalOrder(tasks, done).slice(0, 5);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>

      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-sm opacity-80">
          Completed: {completedCount}/{tasks.length}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
          />
          Hide completed
        </label>
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
          const completed = !!done[t.id];
          const ready = isReady(t);

          return (
            <div
              key={t.id}
              className={`rounded-lg border p-4 ${!ready ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 rounded border"
                  checked={completed}
                  onChange={() => toggle(t.id)}
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
