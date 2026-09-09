import type { Core } from '@strapi/strapi';
import cron, { type ScheduledTask } from 'node-cron';

import type { FlowDTO } from '../../../shared/flow';

/**
 * In-process cron for flows with the `cron` trigger.
 *
 * Runs inside the Strapi Node process, so there is nothing extra to deploy. That also
 * means each instance schedules its own jobs: behind more than one instance, either run
 * the scheduler on a single designated node or move to an external scheduler.
 *
 * Schedules are rebuilt from the database on boot and whenever a flow changes, so editing
 * a cron expression in the GUI takes effect without a restart.
 */
const scheduler = ({ strapi }: { strapi: Core.Strapi }) => {
  const jobs = new Map<string, ScheduledTask>();

  const stopAll = (): void => {
    /*
     * `destroy`, not `stop`. Both prevent a task from firing again, but node-cron keeps every
     * task it has ever scheduled in a module-level registry and only `destroy` removes it
     * from there. `reload` runs on boot and on every flow save, so stopping would leak a task
     * object per save for the life of the process.
     *
     * Both return a promise in v4; the scheduler does not need to await either.
     */
    for (const job of jobs.values()) void job.destroy();
    jobs.clear();
  };

  return {
    async reload(): Promise<number> {
      stopAll();

      const flows: FlowDTO[] = await strapi
        .plugin('content-hub-flow')
        .service('flow')
        .findByTrigger('cron');

      for (const flow of flows) {
        const expression = flow.triggerConfig.cron;

        if (!expression) {
          strapi.log.warn(`[content-hub-flow] cron flow "${flow.name}" has no cron expression`);
          continue;
        }

        if (!cron.validate(expression)) {
          // A bad expression must not take the scheduler down with it.
          strapi.log.error(
            `[content-hub-flow] invalid cron expression "${expression}" on flow "${flow.name}"`
          );
          continue;
        }

        const job = cron.schedule(expression, () => {
          void strapi
            .plugin('content-hub-flow')
            .service('engine')
            .dispatchCron(flow)
            .catch((error: Error) =>
              strapi.log.error(`[content-hub-flow] cron flow "${flow.name}": ${error.message}`)
            );
        });

        jobs.set(flow.documentId, job);
      }

      strapi.log.info(`[content-hub-flow] scheduled ${jobs.size} cron flow(s)`);
      return jobs.size;
    },

    stopAll,

    get scheduledCount(): number {
      return jobs.size;
    },
  };
};

export default scheduler;
