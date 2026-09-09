import type { Core } from '@strapi/strapi';

import engine from './engine';
import flow from './flow';
import registry from './registry';
import scheduler from './scheduler';

/** Annotated for declaration portability under pnpm (see docs/package-conventions.md). */
const services: Record<string, (context: { strapi: Core.Strapi }) => unknown> = {
  registry,
  engine,
  flow,
  scheduler,
};

export default services;
