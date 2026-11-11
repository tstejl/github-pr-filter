import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSemanticsPreview } from "./view-semantics/prototype";

const meta = {
  title: "Proposal/View semantics",
  render: createSemanticsPreview,
  args: { theme: "light", screen: "manage" },
  argTypes: {
    theme: { control: "inline-radio", options: ["light", "dark"] },
    screen: {
      control: "select",
      options: ["picker", "manage", "form", "hidden", "starters", "draft", "deleted", "validation"]
    }
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Storybook-only exploration. All views are editable peers; menu visibility, deletion, and adding starter copies have separate meanings. Back retains local drafts; one Save commits the session. Nothing touches extension storage."
      }
    }
  }
} satisfies Meta<Parameters<typeof createSemanticsPreview>[0]>;
export default meta;
type Story = StoryObj<Parameters<typeof createSemanticsPreview>[0]>;
export const ManageViews: Story = {};
export const InteractiveFlow: Story = { args: { screen: "picker" } };
export const EditView: Story = { args: { screen: "form" } };
export const HiddenView: Story = { args: { screen: "hidden" } };
export const StarterViews: Story = { args: { screen: "starters" } };
export const DraftKept: Story = { args: { screen: "draft" } };
export const UndoDeletion: Story = { args: { screen: "deleted" } };
export const Validation: Story = { args: { screen: "validation" } };
export const Dark: Story = { args: { theme: "dark" } };
