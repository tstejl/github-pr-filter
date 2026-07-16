import type { StorybookConfig } from "@storybook/html-vite";

const config = {
  stories: ["../stories/**/*.stories.ts"],
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "@storybook/html-vite",
    options: {}
  }
} satisfies StorybookConfig;

export default config;
