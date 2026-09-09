import { Lightning } from "@strapi/icons";

/**
 * The plugin's glyph in the main navigation.
 *
 * Distinct per plugin on purpose: the navigation is a column of icons, and with the SDK's
 * default `PuzzlePiece` in every plugin the seven Content Hub entries were
 * indistinguishable from one another. A bolt reads as automation.
 */
const PluginIcon = () => <Lightning />;

export { PluginIcon };
