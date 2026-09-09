import type { Core } from '@strapi/strapi';

import type { Trigger } from '../../shared/flow';

/** Strapi document-service events mapped onto flow triggers. */
const DOCUMENT_ACTIONS: Record<string, Trigger> = {
  create: 'entry.create',
  update: 'entry.update',
  publish: 'entry.publish',
  unpublish: 'entry.unpublish',
};

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const engine = strapi.plugin('content-hub-flow').service('engine');

  /**
   * One global document-service middleware feeds every content event into the engine.
   *
   * Registering here rather than per content-type means a flow can start listening to a
   * content-type that did not exist when the server booted — which content-types are
   * watched is data, and data changes at runtime.
   */
  strapi.documents.use(async (context, next) => {
    const result = await next();

    const trigger = DOCUMENT_ACTIONS[context.action];
    // Ignore the plugin's own bookkeeping, or a flow run would trigger more flows.
    if (!trigger || context.uid.startsWith('plugin::content-hub-flow')) {
      return result;
    }

    const entry = result as Record<string, unknown> | null;

    // Dispatch after the write has resolved, and never let a flow failure fail the write
    // that triggered it: automation is a consequence of the edit, not part of it.
    void engine
      .dispatch({
        trigger,
        uid: context.uid,
        documentId: entry?.documentId as string | undefined,
        entry: entry ?? undefined,
      })
      .catch((error: Error) =>
        strapi.log.error(`[content-hub-flow] ${trigger} dispatch failed: ${error.message}`)
      );

    return result;
  });

  /**
   * Subscribe to the editorial workflow, when that plugin is installed.
   *
   * The dependency is one-way and optional: the flow engine works without the workflow
   * plugin, and the workflow plugin has never heard of flows.
   */
  const workflow = strapi.plugin('content-hub-workflow');

  if (workflow) {
    workflow.service('events').on((payload: Record<string, unknown>) => {
      void engine
        .dispatch({
          trigger: 'stage.changed',
          uid: payload.uid as string,
          documentId: payload.documentId as string,
          extra: payload,
        })
        .catch((error: Error) =>
          strapi.log.error(`[content-hub-flow] stage.changed dispatch failed: ${error.message}`)
        );
    });

    strapi.log.info('[content-hub-flow] subscribed to content-workflow.stage.changed');
  }

  await strapi.plugin('content-hub-flow').service('scheduler').reload();
};

export default bootstrap;
