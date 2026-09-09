import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /*
     * Only the diagram geometry is unit-tested. It is the part of the canvas that is
     * arithmetic rather than appearance — orthogonal routing, obstacle avoidance, and how an
     * old array-ordered flow is read as a graph — and all of it is free of React, Strapi and
     * the DOM so the suite needs no browser.
     */
    include: ['shared/**/*.test.ts'],
    environment: 'node',
  },
});
