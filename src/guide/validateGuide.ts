import type { Guide } from "./types";

export function validateGuide(guide: Guide): string[] {
  const errors: string[] = [];

  if (!guide.version) errors.push("guide.version is missing");
  if (!guide.steps?.length) errors.push("guide.steps is empty");

  const stepIds = new Set<string>();
  const taskIds = new Set<string>();

  for (const step of guide.steps ?? []) {
    if (stepIds.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
    stepIds.add(step.id);

    for (const task of step.tasks ?? []) {
      if (taskIds.has(task.id)) errors.push(`duplicate task id: ${task.id}`);
      taskIds.add(task.id);
    }
  }

  // Validate dependencies point to existing tasks
  for (const step of guide.steps ?? []) {
    for (const task of step.tasks ?? []) {
      for (const dep of task.dependencies ?? []) {
        if (!taskIds.has(dep)) errors.push(`task ${task.id} depends on missing task ${dep}`);
      }
    }
  }

  return errors;
}