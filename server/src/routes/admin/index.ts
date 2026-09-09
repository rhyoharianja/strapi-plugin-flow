export default () => ({
  type: 'admin',
  routes: [
    { method: 'GET', path: '/flows', handler: 'flow.find', config: { policies: [] } },
    { method: 'POST', path: '/flows', handler: 'flow.create', config: { policies: [] } },
    {
      method: 'PUT',
      path: '/flows/:documentId',
      handler: 'flow.update',
      config: { policies: [] },
    },
    {
      method: 'DELETE',
      path: '/flows/:documentId',
      handler: 'flow.delete',
      config: { policies: [] },
    },
    // Manual run, for testing a flow without waiting for its trigger.
    {
      method: 'POST',
      path: '/flows/:documentId/run',
      handler: 'flow.run',
      config: { policies: [] },
    },
    // Registered operations, including ones contributed by other plugins.
    { method: 'GET', path: '/steps', handler: 'flow.steps', config: { policies: [] } },
    // Triggers, content-types and stages the builder offers as choices.
    { method: 'GET', path: '/schema', handler: 'flow.schema', config: { policies: [] } },
    { method: 'GET', path: '/runs', handler: 'flow.runs', config: { policies: [] } },
  ],
});
