import type { Core } from '@strapi/strapi';
import { evaluateCondition, getPath } from '../../../shared/flow';

import {
  UID,
  type FlowDTO,
  type FlowStep,
  type RunContext,
  type RunStatus,
  type StepResult,
  type Trigger,
} from '../../../shared/flow';
import { toGraph } from '../../../shared/diagram/graph';
import { documents } from '../utils/documents';

/**
 * Resolve `{{path}}` placeholders in a step config against the data chain.
 *
 * A whole-string placeholder (`"{{entry.title}}"`) keeps the referenced value's type, so a
 * number stays a number; an embedded one is interpolated as text. This is what lets one
 * step consume the previous step's output without any wiring.
 */
export const resolveTemplates = (value: unknown, context: RunContext): unknown => {
  const scope: Record<string, unknown> = {
    ...context.data,
    entry: context.entry,
    uid: context.uid,
    documentId: context.documentId,
    trigger: context.trigger,
  };

  if (typeof value === 'string') {
    const whole = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(value);
    if (whole) return getPath(scope, whole[1]!);

    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => {
      const resolved = getPath(scope, path.trim());
      return resolved === undefined || resolved === null ? '' : String(resolved);
    });
  }

  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, context));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveTemplates(item, context),
      ])
    );
  }

  return value;
};

/** Raised by the `condition` step to stop a flow without marking it failed. */
export class FlowHalt extends Error {
  constructor(message = 'Condition not met') {
    super(message);
    this.name = 'FlowHalt';
  }
}

/**
 * How many operations one run may execute.
 *
 * A graph can legitimately loop — a retry edge back into an earlier operation is a
 * reasonable thing to draw — so the guard is a budget rather than a ban on revisiting. It is
 * high enough that no sane flow reaches it and low enough that a runaway one is stopped in
 * under a second.
 */
const MAX_STEPS_PER_RUN = 200;

const engine = ({ strapi }: { strapi: Core.Strapi }) => {
  const registry = () => strapi.plugin('flow').service('registry');

  return {
    /**
     * Run one flow, following its graph, recording a `flow-run` either way.
     *
     * A failing operation takes its `reject` edge if it has one — that is a handled failure,
     * not a failed run. Without one the run ends there: later operations generally assume
     * the earlier ones succeeded, and half-applying an automation is worse than a clean,
     * logged failure.
     */
    async run(flow: FlowDTO, context: RunContext): Promise<{ status: RunStatus; steps: StepResult[] }> {
      const startedAt = new Date().toISOString();

      const run = await documents(strapi, UID.flowRun).create({
        data: {
          flow: flow.documentId,
          flowName: flow.name,
          status: 'running',
          // The trigger that actually started this run, not the flow's configured one:
          // a manual test run of a cron flow must not be logged as a cron firing.
          trigger: context.trigger,
          input: {
            uid: context.uid,
            documentId: context.documentId,
            trigger: context.trigger,
          },
          startedAt,
        },
      });

      const results: StepResult[] = [];
      let status: RunStatus = 'success';
      let error: string | null = null;

      /*
       * Walk the graph rather than the array.
       *
       * Each operation has two outgoing edges: `resolve` for success and `reject` for
       * failure. That is what makes the canvas more than a picture — a branch drawn on it
       * has to be a branch the engine takes. A flow with no edges at all is read as the
       * ordered chain it was written as, so nothing had to be migrated.
       */
      const { nodes, firstStep } = toGraph(flow.steps, flow.firstStep);
      const byId = new Map(flow.steps.map((step) => [step.id, step]));
      const edges = new Map(nodes.map((node) => [node.id, node]));

      let currentId: string | null = firstStep;
      let executed = 0;

      while (currentId) {
        /*
         * A budget, not a visited-set. Revisiting a step is legitimate — a retry loop back
         * into an earlier operation is a reasonable thing to draw — but an unbounded one
         * would run until the process died. The cap is recorded as a failure so a runaway
         * flow is visible in the log rather than merely absent.
         */
        if (executed >= MAX_STEPS_PER_RUN) {
          status = 'failed';
          error = `Stopped after ${MAX_STEPS_PER_RUN} operations: the flow has a loop with no exit`;
          break;
        }

        const step = byId.get(currentId);
        const edge = edges.get(currentId);

        if (!step) {
          // `toGraph` drops edges to deleted steps, so this means a corrupt flow rather
          // than an ordinary dangling link.
          status = 'failed';
          error = `Flow points at operation "${currentId}", which does not exist`;
          break;
        }

        executed += 1;

        const handler = registry().get(step.type);
        const stepStart = Date.now();

        if (!handler) {
          results.push({
            stepId: step.id,
            type: step.type,
            status: 'failed',
            error: `No handler registered for step type "${step.type}"`,
            durationMs: 0,
          });
          status = 'failed';
          error = `Unknown step type "${step.type}"`;
          break;
        }

        try {
          const config = resolveTemplates(step.config ?? {}, context) as Record<string, unknown>;
          const output = await handler(context, config);

          // Feed the chain: by step id, and as `$last` for whatever runs next.
          context.data[step.id] = output;
          context.data.$last = output;

          results.push({
            stepId: step.id,
            type: step.type,
            status: 'success',
            output,
            durationMs: Date.now() - stepStart,
          });

          currentId = edge?.resolve ?? null;
        } catch (stepError) {
          if (stepError instanceof FlowHalt) {
            // A deliberate stop, not a failure: whatever came next simply does not apply.
            results.push({
              stepId: step.id,
              type: step.type,
              status: 'skipped',
              output: stepError.message,
              durationMs: Date.now() - stepStart,
            });
            status = 'skipped';
            break;
          }

          results.push({
            stepId: step.id,
            type: step.type,
            status: 'failed',
            error: (stepError as Error).message,
            durationMs: Date.now() - stepStart,
          });

          /*
           * A failure branch means the failure was *expected*, so the run is not a failure —
           * it took the other path. Without one the run ends failed, exactly as the linear
           * engine did: later operations assume the earlier ones succeeded, and
           * half-applying an automation is worse than a clean, logged failure.
           */
          if (edge?.reject) {
            currentId = edge.reject;
            continue;
          }

          status = 'failed';
          error = (stepError as Error).message;
          break;
        }
      }

      await documents(strapi, UID.flowRun).update({
        documentId: run.documentId,
        data: {
          status,
          output: { steps: results },
          error,
          finishedAt: new Date().toISOString(),
        },
      });

      return { status, steps: results };
    },

    /**
     * Run one cron flow.
     *
     * A cron flow that scopes itself to content-types runs **once per entry**, so steps
     * like `wait-until` can read that entry's own date field. Without scoped
     * content-types it runs once with no target entry, which suits housekeeping flows.
     */
    async dispatchCron(flow: FlowDTO): Promise<void> {
      const contentTypes = flow.triggerConfig.contentTypes ?? [];

      if (contentTypes.length === 0) {
        await this.run(flow, {
          trigger: 'cron',
          data: { $trigger: { at: new Date().toISOString() } },
        });
        return;
      }

      for (const uid of contentTypes) {
        const entries = await documents(strapi, uid).findMany({ status: 'published' });

        for (const entry of entries) {
          if (
            flow.conditions &&
            !evaluateCondition(flow.conditions, entry as Record<string, unknown>)
          ) {
            continue;
          }

          await this.run(flow, {
            trigger: 'cron',
            uid,
            documentId: entry.documentId,
            entry: entry as Record<string, unknown>,
            data: { $trigger: { at: new Date().toISOString(), uid, documentId: entry.documentId } },
          });
        }
      }
    },

    /**
     * Find every enabled flow whose trigger and conditions match, and run them.
     *
     * Flows run sequentially rather than in parallel: two flows on the same entry would
     * otherwise race on the same document.
     */
    async dispatch(params: {
      trigger: Trigger;
      uid?: string;
      documentId?: string;
      entry?: Record<string, unknown>;
      extra?: Record<string, unknown>;
    }): Promise<void> {
      const flows: FlowDTO[] = await strapi
        .plugin('flow')
        .service('flow')
        .findByTrigger(params.trigger, params.uid);

      for (const flow of flows) {
        const context: RunContext = {
          trigger: params.trigger,
          uid: params.uid,
          documentId: params.documentId,
          entry: params.entry,
          data: { $trigger: { ...params.extra, uid: params.uid, documentId: params.documentId } },
        };

        // Conditions are evaluated against the entry plus the trigger payload, so a flow
        // can filter on `$trigger.toStage` as easily as on a content field.
        if (
          flow.conditions &&
          !evaluateCondition(flow.conditions, {
            ...(params.entry ?? {}),
            $trigger: context.data.$trigger,
          })
        ) {
          continue;
        }

        try {
          await this.run(flow, context);
        } catch (runError) {
          // `run` records its own failures; this only guards the loop itself.
          strapi.log.error(
            `[flow] flow "${flow.name}" crashed: ${(runError as Error).message}`
          );
        }
      }
    },
  };
};

export default engine;
