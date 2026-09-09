import type { Core } from '@strapi/strapi';
import { evaluateCondition, type ConditionGroup } from '../../../shared/flow';

import type { RunContext, StepDefinition } from '../../../shared/flow';
import { FlowHalt } from '../services/engine';
import { documents } from '../utils/documents';

/**
 * Built-in operations.
 *
 * Every handler receives the data chain and a config whose `{{path}}` placeholders the
 * engine has already resolved, and returns the value that becomes the next step's
 * `$last`. Handlers throw on failure — the engine turns that into a failed run.
 */

const requireTarget = (
  context: RunContext,
  config: Record<string, unknown>
): { uid: string; documentId: string } => {
  const uid = (config.uid as string) ?? context.uid;
  const documentId = (config.documentId as string) ?? context.documentId;

  if (!uid || !documentId) {
    throw new Error('No target entry: this step needs a uid and documentId');
  }

  return { uid, documentId };
};

export const builtInSteps = (strapi: Core.Strapi): StepDefinition[] => [
  {
    type: 'write-log',
    label: 'Write to log',
    description: 'Append a message to the Strapi log and the run output',
    group: 'Utility',
    fields: [
      {
        name: 'message',
        label: 'Message',
        type: 'text',
        required: true,
        placeholder: 'took down {{entry.title}}',
        hint: 'Supports {{placeholders}} from the data chain',
      },
      {
        name: 'level',
        label: 'Level',
        type: 'select',
        default: 'info',
        options: [
          { label: 'info', value: 'info' },
          { label: 'warn', value: 'warn' },
          { label: 'error', value: 'error' },
          { label: 'debug', value: 'debug' },
        ],
      },
    ],
    handler: (_context, config) => {
      const message = String(config.message ?? '');
      const level = (config.level as string) ?? 'info';

      (strapi.log as unknown as Record<string, (msg: string) => void>)[level]?.(
        `[flow] ${message}`
      );

      return { message, level };
    },
  },

  {
    type: 'condition',
    label: 'Condition',
    description: 'Stop the flow unless the condition matches (marks the run "skipped")',
    group: 'Control',
    fields: [
      {
        name: 'conditions',
        label: 'Condition group',
        type: 'json',
        required: true,
        hint: "{ match: 'and', conditions: [{ field, operator, value }] }",
      },
      {
        name: 'message',
        label: 'Skip reason',
        type: 'text',
        placeholder: 'Not live any more',
        hint: 'Recorded on the run when the condition stops the flow',
      },
    ],
    handler: (context, config) => {
      const group = config.conditions as ConditionGroup | undefined;

      if (!group) return { matched: true };

      const scope = { ...(context.entry ?? {}), ...context.data };

      if (!evaluateCondition(group, scope)) {
        throw new FlowHalt((config.message as string) ?? 'Condition not met');
      }

      return { matched: true };
    },
  },

  {
    type: 'update-field',
    label: 'Update fields',
    description: 'Write one or more fields on the target entry',
    group: 'Content',
    fields: [
      {
        name: 'data',
        label: 'Fields to write',
        type: 'json',
        required: true,
        hint: '{ "lifecycleStatus": "Taken down" }',
      },
      {
        name: 'uid',
        label: 'Content-type',
        type: 'content-type',
        hint: 'Leave empty to use the entry that triggered the flow',
      },
      { name: 'documentId', label: 'Document id', type: 'text', hint: 'Leave empty for the triggering entry' },
    ],
    handler: async (context, config) => {
      const { uid, documentId } = requireTarget(context, config);
      const data = (config.data as Record<string, unknown>) ?? {};

      const updated = await documents(strapi, uid).update({ documentId, data });

      // Keep the chain's view of the entry current for later steps.
      context.entry = { ...(context.entry ?? {}), ...data };

      return { uid, documentId, fields: Object.keys(data), updatedAt: updated?.updatedAt };
    },
  },

  {
    type: 'set-status',
    label: 'Set status',
    description: 'Shorthand for update-field on a single status field',
    group: 'Content',
    fields: [
      { name: 'uid', label: 'Content-type', type: 'content-type', hint: 'Leave empty for the triggering entry' },
      { name: 'field', label: 'Field', type: 'field', required: true, default: 'status' },
      { name: 'value', label: 'Value', type: 'text', required: true, placeholder: 'Taken down' },
    ],
    handler: async (context, config) => {
      const { uid, documentId } = requireTarget(context, config);
      const field = (config.field as string) ?? 'status';
      const value = config.value;

      await documents(strapi, uid).update({ documentId, data: { [field]: value } });
      context.entry = { ...(context.entry ?? {}), [field]: value };

      return { uid, documentId, field, value };
    },
  },

  {
    type: 'publish',
    label: 'Publish entry',
    group: 'Content',
    fields: [
      { name: 'uid', label: 'Content-type', type: 'content-type', hint: 'Leave empty for the triggering entry' },
      { name: 'documentId', label: 'Document id', type: 'text', hint: 'Leave empty for the triggering entry' },
    ],
    handler: async (context, config) => {
      const { uid, documentId } = requireTarget(context, config);
      await documents(strapi, uid).publish({ documentId });
      return { uid, documentId, published: true };
    },
  },

  {
    type: 'unpublish',
    label: 'Unpublish entry',
    group: 'Content',
    fields: [
      { name: 'uid', label: 'Content-type', type: 'content-type', hint: 'Leave empty for the triggering entry' },
      { name: 'documentId', label: 'Document id', type: 'text', hint: 'Leave empty for the triggering entry' },
    ],
    handler: async (context, config) => {
      const { uid, documentId } = requireTarget(context, config);
      await documents(strapi, uid).unpublish({ documentId });
      return { uid, documentId, published: false };
    },
  },

  {
    type: 'http-request',
    label: 'HTTP request',
    description: 'Call an external endpoint; the parsed response becomes the chain value',
    group: 'Integration',
    fields: [
      { name: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://api.example.com/hook' },
      {
        name: 'method',
        label: 'Method',
        type: 'select',
        default: 'GET',
        options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((verb) => ({ label: verb, value: verb })),
      },
      { name: 'headers', label: 'Headers', type: 'json', hint: '{ "Authorization": "Bearer …" }' },
      { name: 'body', label: 'Body', type: 'json' },
      { name: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: 10000 },
    ],
    handler: async (_context, config) => {
      const url = String(config.url ?? '');
      if (!url) throw new Error('http-request needs a url');

      const timeoutMs = Number(config.timeoutMs ?? 10000);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: (config.method as string) ?? 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...((config.headers as Record<string, string>) ?? {}),
          },
          ...(config.body !== undefined ? { body: JSON.stringify(config.body) } : {}),
          signal: controller.signal,
        });

        const text = await response.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // Not JSON — the raw text is the useful value.
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${url}`);
        }

        return { status: response.status, body };
      } finally {
        clearTimeout(timer);
      }
    },
  },

  {
    type: 'send-email',
    label: 'Send email',
    description: 'Send through Strapi’s email plugin',
    group: 'Integration',
    fields: [
      { name: 'to', label: 'To', type: 'text', required: true, placeholder: 'ops@example.com' },
      { name: 'subject', label: 'Subject', type: 'text', required: true },
      { name: 'text', label: 'Plain text body', type: 'textarea' },
      { name: 'html', label: 'HTML body', type: 'textarea' },
    ],
    handler: async (_context, config) => {
      await strapi.plugin('email').service('email').send({
        to: config.to,
        subject: config.subject,
        text: config.text,
        html: config.html,
      });

      return { to: config.to, subject: config.subject };
    },
  },

  {
    type: 'wait-until',
    label: 'Wait until',
    description:
      'Stop the flow while a date field is still in the future; the cron trigger re-runs it later',
    group: 'Control',
    fields: [
      {
        name: 'field',
        label: 'Date field',
        type: 'field',
        placeholder: 'endDate',
        hint: 'Read from the triggering entry',
      },
      {
        name: 'date',
        label: 'Fixed date',
        type: 'text',
        placeholder: '2026-12-31T23:59:00.000Z',
        hint: 'Use instead of a field for a one-off date',
      },
    ],
    handler: (context, config) => {
      const raw =
        config.date ??
        (config.field ? (context.entry ?? {})[config.field as string] : undefined);

      if (!raw) throw new Error('wait-until needs a date or a field holding one');

      const due = new Date(String(raw));
      if (Number.isNaN(due.getTime())) throw new Error(`Invalid date: ${String(raw)}`);

      // In-process waiting would tie up the request and be lost on restart. Instead the
      // step halts, and the cron trigger re-evaluates the flow until the date passes.
      if (due.getTime() > Date.now()) {
        throw new FlowHalt(`Not due yet (waiting until ${due.toISOString()})`);
      }

      return { due: due.toISOString(), reached: true };
    },
  },
];
