export type TaskImpact = "big-upgrade" | "unlock" | "time-gate";

export type Task = {
  id: string;
  title: string;
  type: string;
  why?: string;
  how?: string;
  prerequisites?: string[];
  impact?: TaskImpact[];
};

export type Step = {
  id: string;
  title: string;
  description?: string;
  tasks: Task[];
};

export type Checklist = {
  title: string;
  steps: Step[];
};

const impactWeights: Record<TaskImpact, number> = {
  "big-upgrade": 4,
  unlock: 3,
  "time-gate": 2,
};

export const getImpactScore = (task: Task) =>
  (task.impact ?? []).reduce((sum, impact) => sum + impactWeights[impact], 0);

export const getAllTasks = (steps: Step[]) =>
  steps.flatMap((step) => step.tasks);

export const isTaskReady = (task: Task, done: Record<string, boolean>) =>
  (task.prerequisites ?? []).every((prereq) => done[prereq] === true);

export const getTopologicalOrder = (tasks: Task[]) => {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const inDegree = new Map<string, number>();
  const edges = new Map<string, string[]>();

  tasks.forEach((task) => {
    inDegree.set(task.id, 0);
    edges.set(task.id, []);
  });

  tasks.forEach((task) => {
    (task.prerequisites ?? []).forEach((prereq) => {
      if (!taskMap.has(prereq)) return;
      edges.get(prereq)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    });
  });

  const queue = Array.from(inDegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b));

  const ordered: string[] = [];

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    ordered.push(current);
    edges.get(current)?.forEach((neighbor) => {
      const nextDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, nextDegree);
      if (nextDegree === 0) {
        queue.push(neighbor);
        queue.sort((a, b) => a.localeCompare(b));
      }
    });
  }

  const remaining = tasks
    .map((task) => task.id)
    .filter((id) => !ordered.includes(id))
    .sort((a, b) => a.localeCompare(b));

  return [...ordered, ...remaining];
};

export const getNextUpTasks = (
  tasks: Task[],
  done: Record<string, boolean>,
  limit = 5,
) => {
  const topoOrder = getTopologicalOrder(tasks);
  const topoIndex = new Map(topoOrder.map((id, index) => [id, index]));

  return tasks
    .filter((task) => !done[task.id])
    .filter((task) => isTaskReady(task, done))
    .sort((a, b) => {
      const scoreDiff = getImpactScore(b) - getImpactScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return (topoIndex.get(a.id) ?? 0) - (topoIndex.get(b.id) ?? 0);
    })
    .slice(0, limit);
};
