import { useEffect, useState } from "react";
import { Box, Loader, Main, Typography } from "@strapi/design-system";
import { useNavigate, useParams } from "react-router-dom";

import type { FlowDTO } from "../../../shared/flow";
import { api, type FlowSchema, type StepOption } from "../api/client";
import { FlowBuilder } from "../components/FlowBuilder";

/**
 * The flow editor, on its own page.
 *
 * It used to expand inline above the list, which meant the canvas competed for height with a
 * table of flows and a table of runs. A canvas wants the window: panels are 260px wide and a
 * flow of any size is several of them across.
 *
 * `new` and `:documentId` are the same page. The only difference is whether there is a record
 * to load, and saving either creates or updates and returns to the list — so the route is the
 * mode, and nothing has to track "am I editing" in state.
 */
const FlowPage = () => {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  const isNew = documentId === undefined || documentId === "new";

  const [flow, setFlow] = useState<Partial<FlowDTO> | null>(isNew ? {} : null);
  const [operations, setOperations] = useState<StepOption[]>([]);
  const [schema, setSchema] = useState<FlowSchema>({ triggers: [], contentTypes: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [stepList, flowSchema, flows] = await Promise.all([
          api.listSteps(),
          api.schema(),
          // Only fetched when editing; the list endpoint is the one that returns full flows.
          isNew ? Promise.resolve<FlowDTO[]>([]) : api.listFlows(),
        ]);

        setOperations(stepList);
        setSchema(flowSchema);

        if (!isNew) {
          const found = flows.find((candidate) => candidate.documentId === documentId);

          if (!found) {
            setError("That flow no longer exists.");
            return;
          }

          setFlow(found);
        }

        setError(null);
      } catch (loadError) {
        setError((loadError as Error).message);
      }
    })();
  }, [documentId, isNew]);

  const back = () => navigate("..", { relative: "path" });

  if (error) {
    return (
      <Main>
        <Box padding={8}>
          <Typography textColor="danger600">{error}</Typography>
        </Box>
      </Main>
    );
  }

  if (flow === null) {
    return (
      <Main>
        <Box padding={8}>
          <Loader>Loading flow</Loader>
        </Box>
      </Main>
    );
  }

  return (
    <Main>
      <Box padding={8}>
        <FlowBuilder
          flow={flow}
          operations={operations}
          triggers={schema.triggers}
          contentTypes={schema.contentTypes}
          onCancel={back}
          onSave={async (patch) => {
            if (flow.documentId) await api.updateFlow(flow.documentId, patch);
            else await api.createFlow(patch);

            back();
          }}
        />
      </Box>
    </Main>
  );
};

export { FlowPage };
