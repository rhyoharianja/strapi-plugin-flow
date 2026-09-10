import type { Core } from '@strapi/strapi';

import {
  CRON_PRESETS,
  type FlowDTO,
  type RunContext,
  type TriggerDescriptor,
} from '../../../shared/flow';

const controller = ({ strapi }: { strapi: Core.Strapi }) => {
  /**
   * Stage names from the workflow plugin, so a `stage.changed` trigger is picked from the
   * stages that exist rather than typed. Optional dependency: without the plugin the
   * builder simply offers no stage choices.
   */
  const stageOptions = async (): Promise<Array<{ label: string; value: string }>> => {
    const workflow = strapi.plugin('workflow');
    if (!workflow) return [];

    try {
      const workflows = (await workflow.service('workflow').findAll()) as Array<{
        name: string;
        stages: Array<{ name: string }>;
      }>;

      const names = new Set(
        workflows.flatMap((item) => item.stages.map((stage) => stage.name))
      );

      return [...names].sort().map((name) => ({ label: name, value: name }));
    } catch {
      return [];
    }
  };

  const flows = () => strapi.plugin('flow').service('flow');
  const engine = () => strapi.plugin('flow').service('engine');
  const scheduler = () => strapi.plugin('flow').service('scheduler');

  /** Cron schedules are rebuilt after any change so GUI edits take effect immediately. */
  const rescheduleIfCron = async (flow: FlowDTO): Promise<void> => {
    if (flow.trigger === 'cron') await scheduler().reload();
  };

  return {
    async find(ctx): Promise<void> {
      ctx.body = { data: await flows().findAll() };
    },

    /** Operations available to build flows from, including ones other plugins added. */
    async steps(ctx): Promise<void> {
      ctx.body = { data: strapi.plugin('flow').service('registry').list() };
    },

    /**
     * Everything the visual builder needs to offer choices instead of a text box: the
     * triggers with their own inputs, the bindable content-types with their field names,
     * and the workflow stages a `stage.changed` trigger can watch.
     */
    async schema(ctx): Promise<void> {
      const contentTypes = Object.values(strapi.contentTypes)
        .filter((contentType) => contentType.uid.startsWith('api::'))
        .map((contentType) => ({
          uid: contentType.uid,
          displayName: contentType.info?.displayName ?? contentType.uid,
          fields: Object.keys(contentType.attributes ?? {}).sort(),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

      const contentTypeField = {
        name: 'contentTypes',
        label: 'Content-types',
        type: 'content-type' as const,
        hint: 'Leave empty to watch every content-type',
      };

      const triggers: TriggerDescriptor[] = [
        {
          trigger: 'entry.create',
          label: 'Entry created',
          description: 'Runs when a new entry is created',
          fields: [contentTypeField],
        },
        {
          trigger: 'entry.update',
          label: 'Entry updated',
          description: 'Runs when an entry is saved',
          fields: [contentTypeField],
        },
        {
          trigger: 'entry.publish',
          label: 'Entry published',
          description: 'Runs when an entry is published',
          fields: [contentTypeField],
        },
        {
          trigger: 'entry.unpublish',
          label: 'Entry unpublished',
          description: 'Runs when an entry is unpublished',
          fields: [contentTypeField],
        },
        {
          trigger: 'stage.changed',
          label: 'Workflow stage changed',
          description: 'Runs when the editorial workflow moves an entry',
          fields: [
            contentTypeField,
            {
              name: 'toStage',
              label: 'Stage entered',
              type: 'select',
              hint: 'Leave empty for any stage',
              options: await stageOptions(),
            },
          ],
        },
        {
          trigger: 'cron',
          label: 'On a schedule',
          description: 'Runs on a cron expression, once per published entry',
          fields: [
            contentTypeField,
            {
              name: 'cron',
              label: 'Schedule',
              type: 'select',
              required: true,
              options: CRON_PRESETS,
            },
          ],
        },
        {
          trigger: 'manual',
          label: 'Manual only',
          description: 'Runs only when someone presses Run',
          fields: [],
        },
        {
          trigger: 'webhook',
          label: 'Webhook (not yet exposed)',
          description: 'Reserved — the endpoint is not open yet',
          fields: [],
        },
      ];

      ctx.body = { data: { triggers, contentTypes } };
    },

    async create(ctx): Promise<void> {
      const body = ctx.request.body ?? {};

      if (typeof body.name !== 'string' || !body.name.trim()) {
        return ctx.badRequest('name is required');
      }

      const created = await flows().create(body);
      await rescheduleIfCron(created);
      ctx.body = { data: created };
    },

    async update(ctx): Promise<void> {
      const updated = await flows().update(ctx.params.documentId, ctx.request.body ?? {});
      await scheduler().reload();
      ctx.body = { data: updated };
    },

    async delete(ctx): Promise<void> {
      await flows().delete(ctx.params.documentId);
      await scheduler().reload();
      ctx.body = { data: { documentId: ctx.params.documentId } };
    },

    /**
     * Run a flow by hand, for testing.
     *
     * Accepts an optional target entry so a flow written for `entry.update` can be tried
     * against a real document without waiting for someone to edit it.
     */
    async run(ctx): Promise<void> {
      const flow: FlowDTO | null = await flows().findOne(ctx.params.documentId);

      if (!flow) return ctx.notFound('Flow not found');

      const { uid, documentId } = ctx.request.body ?? {};

      const context: RunContext = {
        trigger: 'manual',
        uid,
        documentId,
        entry: undefined,
        data: { $trigger: { manual: true, byUser: ctx.state.user?.id } },
      };

      if (uid && documentId) {
        context.entry =
          (await strapi
            .documents(uid as Parameters<Core.Strapi['documents']>[0])
            .findOne({ documentId })) ?? undefined;
      }

      ctx.body = { data: await engine().run(flow, context) };
    },

    async runs(ctx): Promise<void> {
      const { flow, limit } = ctx.query ?? {};
      ctx.body = {
        data: await flows().runs(Number(limit) || 50, flow as string | undefined),
      };
    },
  };
};

export default controller;
