import type { Core } from '@strapi/strapi';

import { builtInSteps } from './steps';

/**
 * Register the built-in operations.
 *
 * This happens in `register()` rather than `bootstrap()` so the registry is fully
 * populated before the scheduler starts and before any lifecycle can fire — a cron flow
 * must never run against a half-built registry. Other plugins register their own
 * operations from their own `register()` phase for the same reason.
 */
const register = ({ strapi }: { strapi: Core.Strapi }) => {
  const registry = strapi.plugin('content-hub-flow').service('registry');

  for (const step of builtInSteps(strapi)) {
    registry.register(step);
  }

  strapi.log.info(`[content-hub-flow] registered ${registry.list().length} built-in step(s)`);
};

export default register;
