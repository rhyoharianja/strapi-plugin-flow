/**
 * Execution log for one flow run — also the audit trail for everything automation did.
 *
 * `flowName` is denormalised alongside the relation so a run stays readable after its
 * flow is renamed or deleted.
 */
export default {
  kind: 'collectionType',
  collectionName: 'content_hub_flow_runs',
  info: {
    singularName: 'flow-run',
    pluralName: 'flow-runs',
    displayName: 'Flow Run',
    description: 'Execution log of a flow',
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
    flow: {
      type: 'relation',
      relation: 'oneToOne',
      target: 'plugin::content-hub-flow.flow',
    },
    flowName: { type: 'string', required: true },
    status: {
      type: 'enumeration',
      required: true,
      default: 'running',
      enum: ['running', 'success', 'failed', 'skipped'],
    },
    trigger: { type: 'string' },
    /** The context the flow started from. */
    input: { type: 'json', default: {} },
    /** { steps: StepResult[] } */
    output: { type: 'json', default: null },
    error: { type: 'text' },
    startedAt: { type: 'datetime', required: true },
    finishedAt: { type: 'datetime' },
  },
};
