import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextInput,
  Typography,
} from "@strapi/design-system";
import { Check, Cross, Plus, Trash } from "@strapi/icons";

import type { FlowDTO, FlowStep, StepField, Trigger } from "../../../shared/flow";
import type { ContentTypeInfo, StepOption, TriggerOption } from "../api/client";
import {
  TRIGGER_ID,
  TRIGGER_POSITION,
  findFreeSpot,
  toGraph,
} from "../../../shared/diagram/graph";
import { ConfigDrawer } from "./ConfigDrawer";
import { FlowCanvas } from "./FlowCanvas";
import { StepFields } from "./StepFields";

/** Unique, readable step id, used by the run log and by `{{placeholders}}`. */
const makeStepId = (type: string, taken: string[]): string => {
  const base = type.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  if (!taken.includes(base)) return base;

  let suffix = 2;
  while (taken.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

/**
 * Values that came from a JSON textarea are strings; the engine expects objects.
 * Parsed at save time so a half-typed object does not fight the editor on every keystroke.
 */
const materialise = (
  fields: StepField[],
  values: Record<string, unknown>
): { config: Record<string, unknown>; error?: string } => {
  const config: Record<string, unknown> = {};

  for (const field of fields) {
    const value = values[field.name];

    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      if (field.required) return { config, error: `"${field.label}" is required` };
      continue;
    }

    if (field.type === "json" && typeof value === "string") {
      try {
        config[field.name] = JSON.parse(value);
      } catch {
        return { config, error: `"${field.label}" is not valid JSON` };
      }
      continue;
    }

    config[field.name] = value;
  }

  return { config };
};

/**
 * Build a flow by choosing, not by typing.
 *
 * Every choice with a finite set of answers is a dropdown fed by the server: triggers,
 * content-types, their field names, cron presets, workflow stages, and the operations the
 * registry actually holds — including ones other plugins registered. That is what removes
 * the typo class of failure a JSON editor invites, where a misspelled key or a step type
 * that does not exist only surfaces when the flow next fires.
 */
/**
 * A step as the builder holds it: form values, plus the position and edges the canvas edits.
 *
 * Config stays as raw form values until save, because a half-filled number field is a string
 * and validating on every keystroke would fight the person typing.
 */
interface CanvasStep {
  id: string;
  type: string;
  values: Record<string, unknown>;
  x: number;
  y: number;
  resolve: string | null;
  reject: string | null;
}

const FlowBuilder = ({
  flow,
  operations,
  triggers,
  contentTypes,
  onSave,
  onCancel,
}: {
  flow: Partial<FlowDTO>;
  operations: StepOption[];
  triggers: TriggerOption[];
  contentTypes: ContentTypeInfo[];
  onSave: (patch: Partial<FlowDTO>) => Promise<void>;
  onCancel: () => void;
}) => {
  const [name, setName] = useState(flow.name ?? "");
  const [enabled, setEnabled] = useState(flow.enabled ?? true);
  const [trigger, setTrigger] = useState<Trigger>(flow.trigger ?? "manual");
  const [triggerValues, setTriggerValues] = useState<Record<string, unknown>>(
    (flow.triggerConfig ?? {}) as Record<string, unknown>
  );

  /**
   * Steps held with their config as raw form values; converted on save.
   *
   * Position and edges ride along, because the canvas edits them. They start as whatever
   * `toGraph` resolved — which for a flow saved before the canvas existed is the ordered
   * chain it was written as, laid out left to right. Saving then makes that layout explicit,
   * so an old flow is upgraded by being opened and saved rather than by a migration.
   */
  const initial = useMemo(() => toGraph(flow.steps ?? [], flow.firstStep), [flow]);

  const [steps, setSteps] = useState<CanvasStep[]>(() =>
    (flow.steps ?? []).map((step) => {
      const node = initial.nodes.find((candidate: { id: string }) => candidate.id === step.id);

      return {
        id: step.id,
        type: step.type,
        values: { ...(step.config ?? {}) },
        x: node?.x ?? 1,
        y: node?.y ?? 1,
        resolve: node?.resolve ?? null,
        reject: node?.reject ?? null,
      };
    })
  );

  const [firstStep, setFirstStep] = useState<string | null>(initial.firstStep);

  /** Selection is by id now, not array index: on a canvas there is no "next" panel. */
  const [selectedId, setSelectedId] = useState<string | null>(steps[0]?.id ?? null);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const triggerDescriptor = useMemo(
    () => triggers.find((option) => option.trigger === trigger),
    [triggers, trigger]
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, StepOption[]>();
    for (const operation of operations) {
      const group = operation.group ?? "Other";
      groups.set(group, [...(groups.get(group) ?? []), operation]);
    }
    return [...groups.entries()];
  }, [operations]);

  const current = steps.find((step) => step.id === selectedId) ?? null;
  const currentOperation = operations.find((operation) => operation.type === current?.type);

  const addStep = (type: string) => {
    const id = makeStepId(
      type,
      steps.map((step) => step.id)
    );

    // Placed clear of what is already on the canvas, rather than on top of it.
    const spot = findFreeSpot(steps.length > 0 ? steps : [{ id: TRIGGER_ID, ...TRIGGER_POSITION }]);

    setSteps((state) => [
      ...state,
      { id, type, values: {}, x: spot.x, y: spot.y, resolve: null, reject: null },
    ]);

    // The first operation added becomes what the trigger runs; after that, connect by hand.
    setFirstStep((state) => state ?? id);
    setSelectedId(id);
    setAdding("");
  };

  const moveStep = (id: string, x: number, y: number) =>
    setSteps((state) => state.map((step) => (step.id === id ? { ...step, x, y } : step)));

  /**
   * Connect or disconnect one edge.
   *
   * A self-edge is refused: it can only ever mean a mis-drop. Longer loops are allowed —
   * a retry edge back into an earlier operation is a reasonable thing to draw — and the
   * engine bounds them with a per-run budget rather than forbidding them here.
   */
  const connect = (from: string, kind: "resolve" | "reject", to: string | null) => {
    if (to === from) return;

    if (from === TRIGGER_ID) {
      setFirstStep(to);
      return;
    }

    setSteps((state) =>
      state.map((step) => (step.id === from ? { ...step, [kind]: to } : step))
    );
  };

  /**
   * Rename a step, repointing whatever pointed at it.
   *
   * An id is a real reference: other operations resolve to it, the trigger may start at it,
   * and `{{id.…}}` placeholders read its output. Renaming without following those would
   * quietly cut the flow in half.
   */
  const renameStep = (id: string, next: string) => {
    setSteps((state) =>
      state.map((step) => ({
        ...step,
        id: step.id === id ? next : step.id,
        resolve: step.resolve === id ? next : step.resolve,
        reject: step.reject === id ? next : step.reject,
      }))
    );

    setFirstStep((state) => (state === id ? next : state));
    setSelectedId((state) => (state === id ? next : state));
  };

  const removeStep = (id: string) =>
    setSteps((state) =>
      state
        .filter((step) => step.id !== id)
        // An edge into a deleted operation would otherwise be drawn into nothing.
        .map((step) => ({
          ...step,
          resolve: step.resolve === id ? null : step.resolve,
          reject: step.reject === id ? null : step.reject,
        }))
    );

  const save = async () => {
    if (!name.trim()) return setError("Give the flow a name");

    const triggerResult = materialise(triggerDescriptor?.fields ?? [], triggerValues);
    if (triggerResult.error) return setError(`Trigger: ${triggerResult.error}`);

    const built: FlowStep[] = [];

    for (const step of steps) {
      const definition = operations.find((operation) => operation.type === step.type);
      const result = materialise(definition?.fields ?? [], step.values);

      if (result.error) return setError(`Step "${step.id}": ${result.error}`);

      built.push({
        id: step.id,
        type: step.type,
        config: result.config,
        x: step.x,
        y: step.y,
        resolve: step.resolve,
        reject: step.reject,
      });
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        enabled,
        trigger,
        triggerConfig: triggerResult.config as FlowDTO["triggerConfig"],
        conditions: flow.conditions ?? null,
        steps: built,
        firstStep,
      });
      setError(null);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const isTriggerSelected = selectedId === TRIGGER_ID;

  return (
    <Box>
      <Flex justifyContent="space-between" alignItems="flex-start" marginBottom={5} gap={4}>
        <Flex direction="column" alignItems="flex-start" gap={1} style={{ minWidth: 0 }}>
          <Typography variant="alpha" tag="h1">
            {flow.documentId ? "Edit flow" : "New flow"}
          </Typography>
          <Typography variant="epsilon" textColor="neutral600">
            Drag a panel to move it. Drag ✓ (success) or ✗ (failure) onto another panel to
            connect it, or onto empty space to disconnect. Click a panel to configure it.
          </Typography>
        </Flex>
        <Flex gap={2} shrink={0}>
          <Button variant="tertiary" startIcon={<Cross />} onClick={onCancel}>
            Cancel
          </Button>
          <Button startIcon={<Check />} loading={saving} onClick={save}>
            Save flow
          </Button>
        </Flex>
      </Flex>

      {error ? (
        <Box paddingBottom={3}>
          <Typography textColor="danger600">{error}</Typography>
        </Box>
      ) : null}

      <Box
        background="neutral0"
        padding={4}
        hasRadius
        shadow="tableShadow"
        marginBottom={4}
      >
        <Flex gap={3} alignItems="flex-end" wrap="wrap">
          <Box grow={1} minWidth="240px">
            <Field.Root name="flow-name" required>
              <Field.Label>Name</Field.Label>
              <TextInput
                name="flow-name"
                value={name}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setName(event.target.value)
                }
              />
            </Field.Root>
          </Box>
          <Field.Root name="flow-enabled">
            <Field.Label>Enabled</Field.Label>
            <Switch checked={enabled} onCheckedChange={(next: boolean) => setEnabled(next)} />
          </Field.Root>
          <Box minWidth="280px">
            <Field.Root name="add-step" hint="Grouped by what the operation does">
              <Field.Label>Add an operation</Field.Label>
              <SingleSelect
                value={adding}
                placeholder="Choose an operation"
                onChange={(value: string | number) => addStep(String(value))}
              >
                {grouped.flatMap(([group, list]) =>
                  list.map((operation) => (
                    <SingleSelectOption key={operation.type} value={operation.type}>
                      {`${group} · ${operation.label}`}
                    </SingleSelectOption>
                  ))
                )}
              </SingleSelect>
              <Field.Hint />
            </Field.Root>
          </Box>
        </Flex>
      </Box>

      <FlowCanvas
        nodes={steps.map((step) => ({
          id: step.id,
          x: step.x,
          y: step.y,
          resolve: step.resolve,
          reject: step.reject,
          title: operations.find((operation) => operation.type === step.type)?.label ?? step.type,
          subtitle: step.id,
        }))}
        firstStep={firstStep}
        triggerTitle="Trigger"
        triggerSubtitle={triggerDescriptor?.label ?? trigger}
        selectedId={selectedId}
        editing
        onSelect={setSelectedId}
        onMove={moveStep}
        onConnect={connect}
      />

      {/*
        One drawer, two kinds of content — the trigger panel and an operation panel are both
        just "the thing selected on the canvas". Keeping them in one place means the canvas
        never has to know which sort of panel was clicked.
      */}
      <ConfigDrawer
        open={isTriggerSelected || current !== null}
        title={
          isTriggerSelected
            ? "Trigger"
            : (currentOperation?.label ?? current?.type ?? "Operation")
        }
        subtitle={
          isTriggerSelected
            ? (triggerDescriptor?.description ?? "What starts this flow")
            : (currentOperation?.description ?? current?.id)
        }
        onClose={() => setSelectedId(null)}
        footer={
          isTriggerSelected || current === null ? undefined : (
            <Button
              variant="danger-light"
              startIcon={<Trash />}
              onClick={() => {
                removeStep(current.id);
                setSelectedId(null);
              }}
            >
              Remove operation
            </Button>
          )
        }
      >
        {isTriggerSelected ? (
          <>
            <Field.Root name="flow-trigger" hint={triggerDescriptor?.description}>
              <Field.Label>Trigger</Field.Label>
              <SingleSelect
                value={trigger}
                onChange={(value: string | number) => {
                  setTrigger(String(value) as Trigger);
                  // Trigger inputs differ per trigger; keeping stale keys would send config
                  // the new trigger never asked for.
                  setTriggerValues({});
                }}
              >
                {triggers.map((option) => (
                  <SingleSelectOption key={option.trigger} value={option.trigger}>
                    {option.label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              <Field.Hint />
            </Field.Root>

            <StepFields
              fields={triggerDescriptor?.fields ?? []}
              values={triggerValues}
              contentTypes={contentTypes}
              onChange={(field, value) =>
                setTriggerValues((state) => ({ ...state, [field]: value }))
              }
            />
          </>
        ) : current ? (
          <>
            <Field.Root
              name="step-id"
              hint="Referenced by other operations as {{id.…}} and shown in the run log"
            >
              <Field.Label>Step id</Field.Label>
              <TextInput
                name="step-id"
                value={current.id}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  renameStep(current.id, event.target.value)
                }
              />
              <Field.Hint />
            </Field.Root>

            <StepFields
              fields={currentOperation?.fields ?? []}
              values={current.values}
              contentTypes={contentTypes}
              scopeUid={
                (current.values.uid as string | undefined) ??
                (triggerValues.contentTypes as string[] | undefined)?.[0]
              }
              onChange={(field, value) =>
                setSteps((state) =>
                  state.map((step) =>
                    step.id === current.id
                      ? { ...step, values: { ...step.values, [field]: value } }
                      : step
                  )
                )
              }
            />
          </>
        ) : null}
      </ConfigDrawer>
    </Box>
  );
};

export { FlowBuilder };
