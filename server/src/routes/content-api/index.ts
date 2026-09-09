/**
 * No public routes yet. The `webhook` trigger will expose a token-guarded endpoint here;
 * until that token handling is designed, leaving it closed is the safe default.
 */
export default () => ({
  type: 'content-api',
  routes: [],
});
