/**
 * A flow, stored entirely as data ("flows-as-data").
 *
 * `conditions` and `steps` are JSON rather than repeatable components: conditions nest
 * (AND/OR groups inside groups) and step configs differ per operation, neither of which a
 * flat Strapi component can express. The JSON shapes are typed in `shared/flow.ts` and the
 * condition shape is the one this plugin's own `shared/flow` evaluates, so the flow
 * engine and field-level RBAC speak the same condition language.
 */
export default {
  kind: 'collectionType',
  collectionName: 'flow_flows',
  info: {
    singularName: 'flow',
    pluralName: 'flows',
    displayName: 'Flow',
    description: 'Automation flow: a trigger, conditions and a graph of operations',
  },
  options: { draftAndPublish: false },
  pluginOptions: {
    /*
     * Hidden from the Content Manager on purpose.
     *
     * The Content Manager is where people edit *content*; this is platform configuration
     * (or a log) that belongs to this plugin's own admin section. Leaving it in the
     * collection-type list buries Article and Page among a dozen internal tables.
     */
    'content-manager': { visible: false },
    'content-type-builder': { visible: false },
  },
  attributes: {
    name: { type: 'string', required: true, maxLength: 120 },
    enabled: { type: 'boolean', default: true },
    trigger: {
      type: 'enumeration',
      required: true,
      default: 'manual',
      enum: [
        'entry.create',
        'entry.update',
        'entry.publish',
        'entry.unpublish',
        'stage.changed',
        'cron',
        'webhook',
        'manual',
      ],
    },
    /** { contentTypes?, cron?, toStage?, secret? } */
    triggerConfig: { type: 'json', default: {} },
    /** ConditionGroup from this plugin's `shared/flow`, or null to always run. */
    conditions: { type: 'json', default: null },
    /** Ordered FlowStep[]. */
    steps: { type: 'json', default: [] },
    /**
     * The step the trigger runs first.
     *
     * A real edge, stored rather than inferred: on the canvas the trigger is a panel with a
     * connector like any other, and deleting the first operation should leave the flow with
     * nothing to run instead of silently promoting whichever step is next in the array.
     *
     * Null on flows saved before the canvas existed — those are read as the ordered chain
     * they were written as. See `toGraph`.
     */
    firstStep: { type: 'string', maxLength: 64 },
  },
};
