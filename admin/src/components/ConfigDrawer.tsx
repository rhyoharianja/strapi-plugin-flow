import * as React from "react";
import { Box, Flex, IconButton, Typography } from "@strapi/design-system";
import { Cross } from "@strapi/icons";

/**
 * A side panel for whatever is selected on the canvas.
 *
 * **Not a `Modal`, deliberately.** Strapi's `Modal` is a Radix dialog: it traps focus and
 * sets `pointer-events: none` on everything behind it. This project has already been bitten
 * by that — it broke dnd-kit inside the Puck editor — and here it would be worse, because
 * the whole point is to keep dragging panels while their configuration is open. So this is a
 * plain positioned panel with no backdrop: the canvas stays live behind it.
 *
 * The cost of that choice is that nothing closes it for you. Escape and the close button are
 * wired here; a click elsewhere is *not* treated as dismissal, because on a canvas almost
 * every click is aimed at something and losing a half-filled form to a stray drag would be
 * its own bug.
 */

const WIDTH = 420;

export interface ConfigDrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Rendered at the bottom, clear of the scrolling body — delete, mostly. */
  footer?: React.ReactNode;
}

export const ConfigDrawer = ({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: ConfigDrawerProps) => {
  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <Box
      aria-hidden={!open}
      background="neutral0"
      shadow="popupShadow"
      borderColor="neutral200"
      borderStyle="solid"
      borderWidth="0 0 0 1px"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: WIDTH,
        maxWidth: "100vw",
        display: "flex",
        flexDirection: "column",
        // Above the canvas, below Strapi's own notifications and dialogs.
        zIndex: 20,
        transform: open ? "translateX(0)" : `translateX(${WIDTH}px)`,
        transition: "transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        // Off-screen it must not swallow clicks meant for the canvas underneath.
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
      }}
    >
      <Flex
        justifyContent="space-between"
        alignItems="flex-start"
        gap={2}
        padding={4}
        borderColor="neutral150"
        borderStyle="solid"
        borderWidth="0 0 1px 0"
        shrink={0}
      >
        <Box paddingRight={2} style={{ minWidth: 0 }}>
          <Typography variant="delta" tag="h2" ellipsis>
            {title}
          </Typography>
          {subtitle ? (
            <Box paddingTop={1}>
              <Typography variant="pi" textColor="neutral600" ellipsis>
                {subtitle}
              </Typography>
            </Box>
          ) : null}
        </Box>
        <IconButton label="Close" variant="tertiary" onClick={onClose}>
          <Cross />
        </IconButton>
      </Flex>

      <Box padding={4} grow={1} style={{ overflowY: "auto", minHeight: 0 }}>
        {children}
      </Box>

      {footer ? (
        <Box
          padding={4}
          borderColor="neutral150"
          borderStyle="solid"
          borderWidth="1px 0 0 0"
          shrink={0}
        >
          {footer}
        </Box>
      ) : null}
    </Box>
  );
};
