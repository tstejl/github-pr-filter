import type { Meta, StoryObj } from "@storybook/html-vite";
import { createDescriptionPreview } from "./description-reveal/prototype";

type Args = Parameters<typeof createDescriptionPreview>[0];
const meta = {
  title: "Extension/Description reveal",
  render: createDescriptionPreview,
  args: { theme: "light", start: "preview", fixture: "example", align: "start" },
  argTypes: {
    theme: { control: "inline-radio", options: ["light", "dark"] },
    start: { control: "inline-radio", options: ["preview", "interactive"] },
    fixture: { control: "select", options: ["example", "long-description", "long-list"] },
    align: { control: "inline-radio", options: ["start", "end"] }
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Extension picker with local sample data. Truncated descriptions reveal their full text after 350ms of row hover or on keyboard focus. The reveal wraps without changing 44px rows, remains hoverable, stays inside the viewport, and dismisses on Escape, scrolling, selection, or menu closure. Escape dismisses the description before the menu. Native title tooltips are replaced by the description reveal. No extension storage or GitHub navigation."
      }
    }
  }
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<Args>;
export const FullDescription: Story = {};
export const HoverAndFocus: Story = { args: { start: "interactive" } };
export const Dark: Story = { args: { theme: "dark" } };
export const LongDescription: Story = { args: { fixture: "long-description" } };
export const LongList: Story = { args: { fixture: "long-list", start: "interactive" } };
export const NearRightEdge: Story = { args: { align: "end" } };
