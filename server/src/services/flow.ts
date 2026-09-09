import type { Core } from '@strapi/strapi';

import {
  UID,
  type FlowDTO,
  type FlowRunDTO,
  type Trigger,
} from '../../../shared/flow';
import { documents, type DocumentRow } from '../utils/documents';

const toFlowDTO = (row: DocumentRow): FlowDTO => ({
  id: row.id,
  documentId: row.documentId,
  name: row.name,
  enabled: row.enabled ?? false,
  trigger: row.trigger,
  triggerConfig: row.triggerConfig ?? {},
  conditions: row.conditions ?? null,
  steps: Array.isArray(row.steps) ? row.steps : [],
  // Null on a flow that predates the canvas; `toGraph` then reads the array as a chain.
  firstStep: typeof row.firstStep === 'string' ? row.firstStep : null,
});

const flow = ({ strapi }: { strapi: Core.Strapi }) => ({
  async findAll(): Promise<FlowDTO[]> {
    const rows = await documents(strapi, UID.flow).findMany({ sort: { name: 'asc' } });
    return rows.map(toFlowDTO);
  },

  async findOne(documentId: string): Promise<FlowDTO | null> {
    const rows = await documents(strapi, UID.flow).findMany({ filters: { documentId } });
    return rows[0] ? toFlowDTO(rows[0]) : null;
  },

  /**
   * Enabled flows listening for `trigger`.
   *
   * A flow with no `contentTypes` in its trigger config listens to every content-type —
   * useful for cross-cutting automations like audit logging.
   */
  async findByTrigger(trigger: Trigger, uid?: string): Promise<FlowDTO[]> {
    const rows = await documents(strapi, UID.flow).findMany({
      filters: { enabled: true, trigger },
    });

    return rows.map(toFlowDTO).filter((item) => {
      const scoped = item.triggerConfig.contentTypes ?? [];
      return scoped.length === 0 || !uid || scoped.includes(uid);
    });
  },

  async create(data: Partial<FlowDTO>): Promise<FlowDTO> {
    const created = await documents(strapi, UID.flow).create({
      data: {
        name: data.name,
        enabled: data.enabled ?? true,
        trigger: data.trigger ?? 'manual',
        triggerConfig: data.triggerConfig ?? {},
        conditions: data.conditions ?? null,
        steps: data.steps ?? [],
        firstStep: data.firstStep ?? null,
      },
    });

    return toFlowDTO(created);
  },

  async update(documentId: string, data: Partial<FlowDTO>): Promise<FlowDTO> {
    const updated = await documents(strapi, UID.flow).update({
      documentId,
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.trigger !== undefined ? { trigger: data.trigger } : {}),
        ...(data.triggerConfig !== undefined ? { triggerConfig: data.triggerConfig } : {}),
        ...(data.conditions !== undefined ? { conditions: data.conditions } : {}),
        ...(data.steps !== undefined ? { steps: data.steps } : {}),
        ...(data.firstStep !== undefined ? { firstStep: data.firstStep } : {}),
      },
    });

    return toFlowDTO(updated);
  },

  async delete(documentId: string): Promise<void> {
    await documents(strapi, UID.flow).delete({ documentId });
  },

  /** Recent runs, newest first — the audit trail for everything automation did. */
  async runs(limit = 50, flowDocumentId?: string): Promise<FlowRunDTO[]> {
    const rows = await documents(strapi, UID.flowRun).findMany({
      ...(flowDocumentId ? { filters: { flow: { documentId: flowDocumentId } } } : {}),
      sort: { startedAt: 'desc' },
      limit,
    });

    return rows as unknown as FlowRunDTO[];
  },
});

export default flow;
