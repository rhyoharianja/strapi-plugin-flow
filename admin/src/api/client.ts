import { getFetchClient, isFetchError } from "@strapi/strapi/admin";

import type {
  FlowDTO,
  FlowRunDTO,
  StepDefinition,
  TriggerDescriptor,
} from "../../../shared/flow";
import { PLUGIN_ID } from "../pluginId";

export type StepOption = Omit<StepDefinition, "handler">;
export type TriggerOption = TriggerDescriptor;

/** A bindable content-type and its field names, for the builder's pickers. */
export interface ContentTypeInfo {
  uid: string;
  displayName: string;
  fields: string[];
}

export interface FlowSchema {
  triggers: TriggerOption[];
  contentTypes: ContentTypeInfo[];
}

/**
 * Strapi's own fetch client.
 *
 * Reading the admin JWT out of storage by hand does not work: Strapi 5 keeps the access
 * token in memory behind an httpOnly refresh cookie, so `localStorage.getItem('jwtToken')`
 * is empty and every call comes back "Missing or invalid credentials". `getFetchClient`
 * attaches the current token and transparently refreshes an expired one.
 */
const client = () => getFetchClient();

const message = (error: unknown): string => {
  if (isFetchError(error)) {
    const payload = error.response?.data as { error?: { message?: string } } | undefined;
    return payload?.error?.message ?? error.message;
  }
  return (error as Error).message;
};

const unwrap = async <T>(request: Promise<{ data: { data?: T } }>): Promise<T> => {
  try {
    const { data } = await request;
    return data.data as T;
  } catch (error) {
    throw new Error(message(error));
  }
};

const base = `/${PLUGIN_ID}`;

export const api = {
  listFlows: () => unwrap<FlowDTO[]>(client().get(`${base}/flows`)),

  createFlow: (body: Partial<FlowDTO>) => unwrap<FlowDTO>(client().post(`${base}/flows`, body)),

  updateFlow: (documentId: string, body: Partial<FlowDTO>) =>
    unwrap<FlowDTO>(client().put(`${base}/flows/${documentId}`, body)),

  toggleFlow: (documentId: string, enabled: boolean) =>
    unwrap<FlowDTO>(client().put(`${base}/flows/${documentId}`, { enabled })),

  deleteFlow: (documentId: string) => unwrap<unknown>(client().del(`${base}/flows/${documentId}`)),

  runFlow: (documentId: string, target?: { uid: string; documentId: string }) =>
    unwrap<{ status: string; steps: Array<{ type: string; status: string }> }>(
      client().post(`${base}/flows/${documentId}/run`, target ?? {})
    ),

  listSteps: () => unwrap<StepOption[]>(client().get(`${base}/steps`)),

  schema: () => unwrap<FlowSchema>(client().get(`${base}/schema`)),

  listRuns: (limit = 25) => unwrap<FlowRunDTO[]>(client().get(`${base}/runs?limit=${limit}`)),
};
