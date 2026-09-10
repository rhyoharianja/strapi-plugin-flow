
import type { StepGraph } from './diagram/graph';

/**
 * Contract shared by this plugin's server and admin bundles, and by any plugin that
 * registers its own operations (the workflow and channels plugins do).
 */

export const PLUGIN_ID = 'flow' as const;

export const UID = {
  flow: 'plugin::flow.flow',
  flowRun: 'plugin::flow.flow-run',
} as const;

/** What starts a flow. */
export const TRIGGERS = [
  'entry.create',
  'entry.update',
  'entry.publish',
  'entry.unpublish',
  'stage.changed',
  'cron',
  'webhook',
  'manual',
] as const;

export type Trigger = (typeof TRIGGERS)[number];

export interface TriggerConfig {
  /** Content-type UIDs the trigger listens to. Empty means every content-type. */
  contentTypes?: string[];
  /** Cron expression, for the `cron` trigger. */
  cron?: string;
  /** Stage name that must be entered, for the `stage.changed` trigger. */
  toStage?: string;
  /** Shared secret, for the `webhook` trigger. */
  secret?: string;
}

/** One operation in a flow, resolved against the step registry by `type`. */
export interface FlowStep extends StepGraph {
  /** Stable id, used in run logs and as the target of `resolve`/`reject`. */
  id: string;
  type: string;
  /** Handler-specific options. Values may contain `{{path}}` placeholders. */
  config: Record<string, unknown>;
  /** Human label shown in the run log and on the canvas. */
  name?: string;
}

export interface FlowDTO {
  id: number;
  documentId: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  triggerConfig: TriggerConfig;
  conditions: ConditionGroup | null;
  steps: FlowStep[];
  /**
   * The step the trigger runs first.
   *
   * Null on a flow that predates the canvas, which is then read as the ordered chain it was
   * written as — see `toGraph`. Nothing needs migrating.
   */
  firstStep?: string | null;
}

export type RunStatus = 'running' | 'success' | 'failed' | 'skipped';

export interface StepResult {
  stepId: string;
  type: string;
  status: 'success' | 'failed' | 'skipped';
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface FlowRunDTO {
  id: number;
  documentId: string;
  flowName: string;
  status: RunStatus;
  trigger: Trigger;
  input: Record<string, unknown>;
  output: { steps: StepResult[] } | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * The data chain.
 *
 * Every step receives the same context object and may write into `data`; the next step
 * sees what the previous one produced. `$last` always holds the previous step's output,
 * so a step can consume its predecessor without knowing its id.
 */
export interface RunContext {
  trigger: Trigger;
  /** The entry that triggered the flow, when there is one. */
  uid?: string;
  documentId?: string;
  entry?: Record<string, unknown>;
  /** Accumulated chain: step id -> output, plus `$last` and `$trigger`. */
  data: Record<string, unknown>;
}

/** Signature every operation handler implements. */
export type StepHandler = (
  context: RunContext,
  config: Record<string, unknown>
) => Promise<unknown> | unknown;

/**
 * A single config input of an operation.
 *
 * Declared alongside the handler so the admin can **build the form** instead of asking for
 * JSON. That removes the whole class of mistakes a free-text config invites: a misspelled
 * key, a string where a number belongs, an option that does not exist. A plugin
 * contributing an operation describes its inputs the same way, so its step is just as
 * safely editable as a built-in one.
 */
export interface StepField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'content-type' | 'field' | 'json';
  hint?: string;
  required?: boolean;
  /** For `select`. */
  options?: Array<{ label: string; value: string }>;
  /** Placeholder shown in the input. */
  placeholder?: string;
  default?: unknown;
}

export interface StepDefinition {
  type: string;
  /** Shown in the operation picker and on the diagram node. */
  label: string;
  description?: string;
  /** Category used to group the operation picker. */
  group?: string;
  /** Inputs this operation takes; drives the generated config form. */
  fields?: StepField[];
  handler: StepHandler;
}

/** Descriptors for the trigger form, so triggers are picked rather than typed. */
export interface TriggerDescriptor {
  trigger: Trigger;
  label: string;
  description: string;
  /** Which `triggerConfig` inputs apply to this trigger. */
  fields: StepField[];
}

/** Common cron expressions, so nobody has to remember the field order. */
export const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Hourly, on the hour', value: '0 * * * *' },
  { label: 'Daily at 01:00', value: '0 1 * * *' },
  { label: 'Daily at 08:00', value: '0 8 * * *' },
  { label: 'Weekly, Monday 08:00', value: '0 8 * * 1' },
];


// ── The condition language ──────────────────────────────────────────────────────────────────
//
// Moved here from a separate `shared-utils` package. Its docstring claimed the language was
// shared with field-level RBAC "so both speak exactly the same condition language" — but that
// plugin never imported it. This engine was the only consumer, so it owns it now.

export type Operator =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
  | 'empty';

/** A single field comparison. */
export interface Condition {
  field: string;
  operator: Operator;
  value?: unknown;
}

export interface ConditionGroup {
  match: 'and' | 'or';
  conditions: Array<Condition | ConditionGroup>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Read a dot-separated path out of a nested object.
 *
 * Returns `undefined` for any missing or non-object segment, so a condition against a field an
 * entry does not have is simply false rather than a thrown error mid-run.
 */
export const getPath = (source: unknown, path: string): unknown => {
  if (!isNonEmptyString(path)) return undefined;

  return path.split('.').reduce<unknown>((current, segment) => {
    if (isRecord(current)) return current[segment];
    if (Array.isArray(current)) return current[Number(segment)];
    return undefined;
  }, source);
};

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => isEqual(a[key], b[key]));
  }
  return false;
};

const isConditionGroup = (node: Condition | ConditionGroup): node is ConditionGroup =>
  'conditions' in node && Array.isArray((node as ConditionGroup).conditions);

const compare = (actual: unknown, operator: Operator, expected: unknown): boolean => {
  switch (operator) {
    case 'eq':
      return isEqual(actual, expected);
    case 'ne':
      return !isEqual(actual, expected);
    case 'in':
      return Array.isArray(expected) && expected.some((item) => isEqual(actual, item));
    case 'nin':
      return Array.isArray(expected) && !expected.some((item) => isEqual(actual, item));
    case 'contains':
      if (Array.isArray(actual)) return actual.some((item) => isEqual(item, expected));
      return typeof actual === 'string' && actual.includes(String(expected));
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'empty':
      if (actual === undefined || actual === null) return true;
      if (typeof actual === 'string') return actual.trim().length === 0;
      if (Array.isArray(actual)) return actual.length === 0;
      if (isRecord(actual)) return Object.keys(actual).length === 0;
      return false;
    default:
      return false;
  }
};

/**
 * Evaluate a condition tree against an entry.
 *
 * An **empty group matches everything**, so a flow with no conditions always runs — the
 * alternative would make "no conditions" mean "never fires", which is the opposite of what an
 * empty field looks like it means.
 */
export const evaluateCondition = (
  node: Condition | ConditionGroup,
  data: Record<string, unknown>
): boolean => {
  if (isConditionGroup(node)) {
    if (node.conditions.length === 0) return true;

    return node.match === 'or'
      ? node.conditions.some((child) => evaluateCondition(child, data))
      : node.conditions.every((child) => evaluateCondition(child, data));
  }

  return compare(getPath(data, node.field), node.operator, node.value);
};
