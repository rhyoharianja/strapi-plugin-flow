import type { Core } from '@strapi/strapi';

import type { StepDefinition, StepHandler } from '../../../shared/flow';

/**
 * The step registry: `stepType -> handler`.
 *
 * This is the extension point other plugins use — a channel plugin registers a delivery
 * operation, a marketing plugin registers `mkt.push`, and so on:
 *
 *   strapi.plugin('flow').service('registry').register({
 *     type: 'mkt.push',
 *     label: 'Push to Marketing Automation',
 *     handler: async (ctx, config) => { ... },
 *   });
 *
 * Registration happens in the registering plugin's `register()` phase, which runs before
 * this plugin's `bootstrap()` starts the scheduler — so a cron flow can never fire against
 * a half-populated registry.
 */
const registry = ({ strapi }: { strapi: Core.Strapi }) => {
  const steps = new Map<string, StepDefinition>();

  return {
    register(definition: StepDefinition): void {
      if (steps.has(definition.type)) {
        // Overwriting silently would make a step's behaviour depend on plugin load order.
        strapi.log.warn(
          `[flow] step "${definition.type}" is already registered; ignoring the duplicate`
        );
        return;
      }

      steps.set(definition.type, definition);
    },

    has(type: string): boolean {
      return steps.has(type);
    },

    get(type: string): StepHandler | undefined {
      return steps.get(type)?.handler;
    },

    /**
     * Every registered operation, for the admin picker.
     *
     * Ships the field descriptors too, so the builder can generate a real form per
     * operation instead of asking for JSON — including for operations other plugins added.
     */
    list(): Array<Omit<StepDefinition, 'handler'>> {
      return [...steps.values()]
        .map(({ type, label, description, group, fields }) => ({
          type,
          label,
          description,
          group: group ?? 'Other',
          fields: fields ?? [],
        }))
        .sort((a, b) => `${a.group}${a.label}`.localeCompare(`${b.group}${b.label}`));
    },
  };
};

export default registry;
