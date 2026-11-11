import type { Meta, StoryObj } from "@storybook/html-vite";
import { createDensityPreview } from "./picker-density/prototype";

type Args = Parameters<typeof createDensityPreview>[0];
const meta = {
  title: "Proposal/Picker height and density",
  render: createDensityPreview,
  args: {
    theme: "dark",
    presentation: "comparison",
    rows: "uniform",
    height: "fit",
    fixture: "mixed",
    anchor: "top",
    maxHeight: 560
  },
  argTypes: {
    theme: { control: "inline-radio", options: ["light", "dark"] },
    presentation: { control: "inline-radio", options: ["comparison", "context"] },
    rows: { control: "select", options: ["current", "uniform", "content"] },
    height: { control: "inline-radio", options: ["current", "fit"] },
    fixture: { control: "select", options: ["mixed", "description-cases", "names-only", "long"] },
    anchor: { control: "inline-radio", options: ["top", "bottom"] },
    maxHeight: { control: { type: "number", min: 320, max: 720, step: 40 } }
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Storybook-only comparison. Previous layout: 48px rows, 400px list cap. Selected design: uniform 44px rows with single-line content centered, and a content-fit panel capped at 560px including its footer. The variable-height alternative remains for comparison. The context preview flips above its anchor when that gives more room. Scroll shadows indicate hidden content. Footer actions only report a preview message. This isolated comparison does not access extension storage."
      }
    }
  }
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<Args>;
export const Comparison: Story = {};
export const Recommended: Story = { args: { presentation: "context" } };
export const CurrentBehavior: Story = {
  name: "Previous behavior",
  args: { presentation: "context", rows: "current", height: "current" }
};
export const DescriptionStates: Story = { args: { fixture: "description-cases" } };
export const NamesOnly: Story = { args: { presentation: "context", fixture: "names-only" } };
export const LongList: Story = { args: { presentation: "context", fixture: "long" } };
export const NearBottom: Story = {
  args: { presentation: "context", fixture: "long", anchor: "bottom" }
};
export const Light: Story = { args: { theme: "light" } };
