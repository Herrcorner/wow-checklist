"use client";

import { useMemo, useState } from "react";
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

export default function Home() {
  const tasks = (checklist as { title: string; tasks: Task[] }).tasks;

  const [done, setDone] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = window.localStorage.getItem("done");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [showCompleted, setShowCompleted] = useState(false);
  const [showReadyOnly, setShowReadyOnly] = useState(false);

  const setDoneAndPersist = (next: Record<string, boolean>) => {
    setDone(next);
    localStorage.setItem("done", JSON.stringify(next));
  };

  const toggle = (id: string) => {
    const next = { ...done, [id]: !done[id] };
    setDoneAndPersist(next);
  };

  const readyById = useMemo(() => {
    return tasks.reduce<Record<string, boolean>>((acc, task) => {
      acc[task.id] = (task.prerequisites ?? []).every((p) => done[p] === true);
      return acc;
    }, {});
  }, [tasks, done]);

  const visibleTasks = useMemo(() => {
    const base = showCompleted ? tasks : tasks.filter((t) => !done[t.id]);
    const filtered = showReadyOnly
      ? base.filter((t) => readyById[t.id])
      : base;

    return [...filtered].sort((a, b) => {
      const af = a.focusFirst ? 1 : 0;
      const bf = b.focusFirst ? 1 : 0;
      if (af !== bf) return bf - af;

      const ar = readyById[a.id] ? 1 : 0;
      const br = readyById[b.id] ? 1 : 0;
      if (ar !== br) return br - ar;

      return a.title.localeCompare(b.title);
    });
  }, [tasks, done, showCompleted, showReadyOnly, readyById]);

  const completedCount = tasks.filter((t) => done[t.id]).length;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{checklist.title}</h1>

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

      <div className="mt-6 space-y-4">
        {visibleTasks.map((t) => {
          const completed = !!done[t.id];
          const ready = readyById[t.id];

          return (
            <div
              key={t.id}
              className={`rounded-lg border p-4 ${
                !ready ? "border-dashed border-slate-300 bg-slate-50/70" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <button
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
                      <span className="rounded border border-slate-300 bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        🔒 Locked — finish prereqs
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
