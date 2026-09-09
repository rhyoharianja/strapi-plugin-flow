import type { Core } from '@strapi/strapi';

import flow from './flow';

/** Annotated for declaration portability under pnpm (see docs/package-conventions.md). */
const controllers: Record<string, (context: { strapi: Core.Strapi }) => unknown> = {
  flow,
};

export default controllers;
