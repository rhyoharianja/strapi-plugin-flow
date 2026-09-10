import type { Core } from '@strapi/strapi';

/**
 * Stop the cron scheduler when this Strapi instance goes away.
 *
 * **This is the fix for a 7,600-line log flood, and the empty stub it replaces was the whole
 * bug.** `strapi develop` reloads the application *in-process*: it destroys the old instance
 * and builds a new one without restarting Node. A `node-cron` task, though, lives in the
 * module registry and knows nothing about that — so every reload left another live job behind,
 * still firing every minute, still holding a closure over an instance that no longer exists.
 *
 * The failure that produced was thoroughly misleading. The job called the document service,
 * which reaches Strapi's own `wrapInTransaction`:
 *
 *     const wrapInTransaction = (fn) => (...args) => strapi.db.transaction?.(() => fn(...args));
 *
 * That reads the **global** `strapi`, which the destroyed instance no longer backs — so the
 * error was `ReferenceError: strapi is not defined`, reported against our flow name, pointing
 * at no line of our code. The error count per minute was simply how many instances had been
 * reloaded, which is why it grew through a working day and why killing stray processes
 * appeared to fix it.
 *
 * Stopping the jobs here is what makes a reload actually forget them. `stopAll` uses
 * `destroy()` rather than `stop()` so the tasks also leave node-cron's module registry.
 */
const destroy = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.plugin('flow').service('scheduler').stopAll();
};

export default destroy;
