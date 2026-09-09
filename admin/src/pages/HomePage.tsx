import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Loader,
  Main,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from "@strapi/design-system";
import { Pencil, Play, Plus, Trash } from "@strapi/icons";

import type { FlowDTO, FlowRunDTO } from "../../../shared/flow";
import { useNavigate } from "react-router-dom";

import { api, type FlowSchema, type StepOption } from "../api/client";

const STATUS_COLOUR: Record<string, string> = {
  success: "success600",
  failed: "danger600",
  skipped: "neutral500",
  running: "warning600",
};

/**
 * Flows live here, not in the Content Manager.
 *
 * The `flow` and `flow-run` tables are hidden from that list so it stays content-only, so
 * this page owns the overview: which flows exist, whether they are enabled, and what their
 * last runs did. Editing happens on its own route — a canvas wants the window rather than a
 * slot between two tables.
 */
const HomePage = () => {
  const navigate = useNavigate();

  const [flows, setFlows] = useState<FlowDTO[] | null>(null);
  const [steps, setSteps] = useState<StepOption[]>([]);
  const [schema, setSchema] = useState<FlowSchema>({ triggers: [], contentTypes: [] });
  const [runs, setRuns] = useState<FlowRunDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [flowList, stepList, runList, flowSchema] = await Promise.all([
        api.listFlows(),
        api.listSteps(),
        api.listRuns(),
        api.schema(),
      ]);
      setFlows(flowList);
      setSteps(stepList);
      setRuns(runList);
      setSchema(flowSchema);
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const run = async (flow: FlowDTO) => {
    setBusy(flow.documentId);
    try {
      await api.runFlow(flow.documentId);
      await reload();
    } catch (runError) {
      setError((runError as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Main>
      <Box padding={8}>
        <Flex justifyContent="space-between" alignItems="flex-start" marginBottom={6}>
          <Flex direction="column" alignItems="flex-start" gap={1}>
            <Typography variant="alpha" tag="h1">
              Flow
            </Typography>
            <Typography variant="epsilon" textColor="neutral600">
              Automation flows stored as data: a trigger, optional conditions and an ordered
              list of operations.
            </Typography>
          </Flex>
          <Button startIcon={<Plus />} onClick={() => navigate("new")}>
            New flow
          </Button>
        </Flex>

        {error ? (
          <Box paddingBottom={4}>
            <Typography textColor="danger600">{error}</Typography>
          </Box>
        ) : null}

        <Box marginBottom={6}>
          <Typography variant="sigma" textColor="neutral600">
            Registered operations ({steps.length})
          </Typography>
          <Flex gap={2} paddingTop={2} wrap="wrap">
            {steps.map((step) => (
              <Badge key={step.type}>{step.type}</Badge>
            ))}
          </Flex>
        </Box>

        {flows === null ? (
          <Loader>Loading flows</Loader>
        ) : (
          <Box marginBottom={6}>
            <Typography variant="sigma" textColor="neutral600">
              Flows ({flows.length})
            </Typography>
            <Box paddingTop={2}>
              <Table colCount={5} rowCount={flows.length + 1}>
                <Thead>
                  <Tr>
                    <Th>
                      <Typography variant="sigma">Name</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Trigger</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Steps</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Enabled</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Actions</Typography>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {flows.map((flow) => (
                    <Tr key={flow.documentId}>
                      <Td>
                        <Typography>{flow.name}</Typography>
                      </Td>
                      <Td>
                        <Badge>{flow.trigger}</Badge>
                      </Td>
                      <Td>
                        <Typography textColor="neutral600">
                          {flow.steps.map((step) => step.type).join(" → ") || "—"}
                        </Typography>
                      </Td>
                      <Td>
                        <Button
                          size="S"
                          variant={flow.enabled ? "success-light" : "tertiary"}
                          onClick={async () => {
                            await api.toggleFlow(flow.documentId, !flow.enabled);
                            await reload();
                          }}
                        >
                          {flow.enabled ? "Enabled" : "Disabled"}
                        </Button>
                      </Td>
                      <Td>
                        <Flex gap={1}>
                          <Button
                            size="S"
                            variant="tertiary"
                            startIcon={<Play />}
                            loading={busy === flow.documentId}
                            onClick={() => run(flow)}
                          >
                            Run
                          </Button>
                          <IconButton
                            label="Edit flow"
                            variant="tertiary"
                            onClick={() => navigate(flow.documentId)}
                          >
                            <Pencil />
                          </IconButton>
                          <IconButton
                            label="Delete flow"
                            variant="danger-light"
                            onClick={async () => {
                              await api.deleteFlow(flow.documentId);
                              await reload();
                            }}
                          >
                            <Trash />
                          </IconButton>
                        </Flex>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          </Box>
        )}

        <Box>
          <Typography variant="sigma" textColor="neutral600">
            Recent runs
          </Typography>
          <Flex direction="column" alignItems="stretch" gap={1} paddingTop={2}>
            {runs.length === 0 ? (
              <Typography textColor="neutral600">Nothing has run yet.</Typography>
            ) : (
              runs.map((entry) => (
                <Flex key={entry.id} gap={2} alignItems="center">
                  <Typography
                    variant="pi"
                    textColor={STATUS_COLOUR[entry.status] ?? "neutral600"}
                  >
                    {entry.status.toUpperCase()}
                  </Typography>
                  <Typography variant="pi">{entry.flowName}</Typography>
                  <Typography variant="pi" textColor="neutral500">
                    {new Date(entry.startedAt).toLocaleString()}
                    {entry.error ? ` · ${entry.error}` : ""}
                  </Typography>
                </Flex>
              ))
            )}
          </Flex>
        </Box>
      </Box>
    </Main>
  );
};

export { HomePage };
