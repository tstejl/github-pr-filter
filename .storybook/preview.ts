import type { Preview } from "@storybook/html-vite";
import "../src/content.css";
import "../stories/storybook.css";

const preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    a11y: { test: "error" }
  }
} satisfies Preview;

export default preview;
