"use client";

import { useEffect, useMemo, useState } from "react";
import checklist from "@/data/checklist.json";
import {
  Checklist,
  getAllTasks,
  getImpactScore,
  getNextUpTasks,
  isTaskReady,
} from "@/lib/checklist";

type Profile = {
  battletag?: string;
  id?: number | null;
};

export default function Home() {
  const { title, steps } = checklist as Checklist;
  const allTasks = getAllTasks(steps);

  const [done, setDone] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem("wow-checklist-done");
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  const [hideCompleted, setHideCompleted] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await fetch("/api/profile");
        if (!response.ok) {
          setProfile(null);
          return;
        }
        const json = (await response.json()) as Profile;
        setProfile(json);
      } catch {
        setProfileError("Unable to reach Battle.net profile.");
      }
    };

    void loadProfile();
  }, []);

  const setDoneAndPersist = (next: Record<string, boolean>) => {
    setDone(next);
    localStorage.setItem("wow-checklist-done", JSON.stringify(next));
  };

  const toggle = (id: string) => {
    const next = { ...done, [id]: !done[id] };
    setDoneAndPersist(next);
  };

  const completedCount = allTasks.filter((task) => done[task.id]).length;
  const overallPercent =
    allTasks.length === 0
      ? 0
      : Math.round((completedCount / allTasks.length) * 100);

  const nextUp = useMemo(
    () => getNextUpTasks(allTasks, done, 5),
    [allTasks, done],
  );

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

          <label className="flex items-center gap-2 text-sm text-amber-100/80">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(event) => setHideCompleted(event.target.checked)}
              className="accent-amber-400"
            />
            Hide completed
          </label>
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {steps.map((step) => {
            const stepTasks = hideCompleted
              ? step.tasks.filter((task) => !done[task.id])
              : step.tasks;
            const stepCompleted = step.tasks.filter((task) => done[task.id])
              .length;
            const stepPercent =
              step.tasks.length === 0
                ? 0
                : Math.round((stepCompleted / step.tasks.length) * 100);

            return (
              <details
                key={step.id}
                className="rounded-xl border border-amber-400/30 bg-slate-950/60 p-4"
                open
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-amber-100">
                        {step.title}
                      </h2>
                      {step.description ? (
                        <p className="text-sm text-amber-100/70">
                          {step.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-amber-100/70">
                      {stepCompleted}/{step.tasks.length} complete
                      <div className="mt-2 h-1.5 w-32 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-amber-400"
                          style={{ width: `${stepPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </summary>

                <div className="mt-4 space-y-3">
                  {stepTasks.map((task) => {
                    const completed = !!done[task.id];
                    const ready = isTaskReady(task, done);
                    const impactScore = getImpactScore(task);

                    return (
                      <div
                        key={task.id}
                        className={`rounded-lg border border-amber-400/20 bg-slate-900/70 p-4 ${
                          !ready ? "opacity-60" : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            className={`mt-1 h-5 w-5 rounded border border-amber-300/40 ${
                              completed ? "bg-amber-300/80" : ""
                            }`}
                            onClick={() => toggle(task.id)}
                            aria-label={`Mark ${task.title} complete`}
                          />

                          <div className="flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-medium text-amber-100">
                                {task.title}
                              </h3>
                              <span className="rounded bg-amber-200/10 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-200/80">
                                {task.type}
                              </span>
                              {task.impact?.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-amber-200/10 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-200/80"
                                >
                                  {tag.replace("-", " ")}
                                </span>
                              ))}
                              {impactScore >= 6 ? (
                                <span className="rounded bg-amber-400/20 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-200">
                                  focus first
                                </span>
                              ) : null}
                              {!ready ? (
                                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-amber-100/70">
                                  locked by prereqs
                                </span>
                              ) : null}
                            </div>

                            {task.why ? (
                              <p className="text-sm text-amber-100/80">
                                <span className="font-semibold text-amber-200">
                                  Why / reward:
                                </span>{" "}
                                {task.why}
                              </p>
                            ) : null}

                            {task.how ? (
                              <p className="text-sm text-amber-100/70">
                                <span className="font-semibold text-amber-200">
                                  How to do it:
                                </span>{" "}
                                {task.how}
                              </p>
                            ) : null}

                            {task.prerequisites?.length ? (
                              <p className="text-xs text-amber-100/60">
                                Prereqs: {task.prerequisites.join(", ")}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}

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
