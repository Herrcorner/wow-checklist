"use client";

import { useState } from "react";
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
  completion?: CompletionRule;
};

type Checklist = {
  title: string;
  tasks: Task[];
};

export default function Home() {
  const { title, tasks } = checklist as Checklist;

  // ✅ Load from localStorage without useEffect (fixes react-hooks/set-state-in-effect)
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem("done");
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const [showCompleted, setShowCompleted] = useState(false);

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
  const baseTasks = showCompleted ? tasks : tasks.filter((t) => !isCompleted(t.id));

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

  const completedCount = tasks.filter((t) => isCompleted(t.id)).length;

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

                  {t.why && <p className="mt-1 text-sm opacity-80">{t.why}</p>}

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
