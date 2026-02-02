export type Standing =
  | "hated"
  | "hostile"
  | "unfriendly"
  | "neutral"
  | "friendly"
  | "honored"
  | "revered"
  | "exalted";

export type CompletionRule =
  | { type: "manual" }
  | { type: "manual_repeatable" }
  | { type: "item_confirmed"; itemId: string } // item owned/equipped/confirmed (no OAuth)
  | { type: "rep_at_least"; factionId: string; standing: Standing }
  | { type: "rep_at_least_any"; options: Array<{ factionId: string; standing: Standing }> }
  | { type: "currency_at_least"; currencyId: string; amount: number };

export type TaskKind = "progression" | "unlock" | "gear" | "reputation" | "currency" | "repeatable";

export type TaskHow = {
  instanceId?: string;
  bossId?: string;
  mode?: "normal" | "heroic" | "raid";
};

export type TaskReward =
  | { type: "item"; itemId: string }
  | { type: "unlock"; unlockId: string };

export type Repeatable = {
  cadence: "weekly" | "daily";
  reset?: "tuesday" | "wednesday";
};

export type Task = {
  id: string;
  title: string;
  kind: TaskKind;
  description?: string;
  dependencies: string[];
  completion: CompletionRule;
  how?: TaskHow;
  rewards?: TaskReward[];
  repeatable?: Repeatable;
  estimates?: { timeHours?: number; notes?: string };
};

export type Step = {
  id: string;
  title: string;
  priority: number;
  description?: string;
  tasks: Task[];
};

export type GuideItemSource =
  | { type: "boss_drop"; bossId: string; mode: "normal" | "heroic" | "raid" }
  | { type: "reputation_vendor"; factionId: string; standing: Standing; altFactionId?: string }
  | { type: "currency_vendor"; currencyId: string; cost: number; location?: string }
  | { type: "crafted"; profession: "tailoring" | "enchanting" | "blacksmithing" | "leatherworking" | "engineering"; bind: "bop" | "boe" };

export type GuideItem = {
  name: string;
  slot: string;
  source: GuideItemSource;
};

export type Guide = {
  version: string;
  game: string;
  patch: string;
  phase: number;
  spec: string;
  meta: {
    title: string;
    description?: string;
    authoring?: { source?: string; lastUpdated?: string };
  };
  glossary: {
    currencies: Record<string, { name: string }>;
    factions: Record<string, { name: string }>;
    instances: Record<string, { name: string }>;
    bosses: Record<string, { name: string; instanceId: string }>;
  };
  items: Record<string, GuideItem>;
  steps: Step[];
};