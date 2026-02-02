import { CompletionRule, Standing } from "@/guide/types";

export type CharacterSnapshot = {
  equipment: string[];
  inventory?: string[];
  reputation?: Record<string, { standing: Standing }>;
  currencies?: Record<string, number>;
  bossKills?: string[];
  bossKillsTrusted?: boolean;
};

export type CompletionEvaluation = {
  completed: boolean;
  needsManualConfirm: boolean;
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

const isStandingAtLeast = (current: Standing, target: Standing) =>
  standingRank[current] >= standingRank[target];

const isItemOwned = (
  itemId: string,
  snapshot: CharacterSnapshot,
): CompletionEvaluation => {
  const inEquipment = snapshot.equipment.includes(itemId);
  const inInventory = snapshot.inventory?.includes(itemId) ?? false;
  const inventoryUnavailable = snapshot.inventory === undefined;

  if (inEquipment || inInventory) {
    return { completed: true, needsManualConfirm: false };
  }

  return { completed: false, needsManualConfirm: inventoryUnavailable };
};

const evaluateRep = (
  factionId: string,
  standing: Standing,
  snapshot: CharacterSnapshot,
): boolean => {
  const rep = snapshot.reputation?.[factionId]?.standing;
  return rep ? isStandingAtLeast(rep, standing) : false;
};

export const evaluateCompletionRule = (
  rule: CompletionRule | undefined,
  snapshot: CharacterSnapshot,
): CompletionEvaluation => {
  if (!rule) {
    return { completed: false, needsManualConfirm: false };
  }

  switch (rule.type) {
    case "manual":
    case "manual_repeatable":
      return { completed: false, needsManualConfirm: false };
    case "item_owned":
    case "item_confirmed":
      return isItemOwned(rule.itemId, snapshot);
    case "rep_at_least":
      return {
        completed: evaluateRep(rule.factionId, rule.standing, snapshot),
        needsManualConfirm: false,
      };
    case "rep_at_least_any":
      return {
        completed: rule.options.some((option) =>
          evaluateRep(option.factionId, option.standing, snapshot),
        ),
        needsManualConfirm: false,
      };
    case "currency_at_least": {
      const amount = snapshot.currencies?.[rule.currencyId] ?? 0;
      return { completed: amount >= rule.amount, needsManualConfirm: false };
    }
    case "boss_killed": {
      const canTrustEndpoint = snapshot.bossKillsTrusted === true;
      const killed = snapshot.bossKills?.includes(rule.bossId) ?? false;
      return { completed: canTrustEndpoint && killed, needsManualConfirm: false };
    }
    default:
      return { completed: false, needsManualConfirm: false };
  }
};
