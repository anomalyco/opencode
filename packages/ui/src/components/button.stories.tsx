// @ts-nocheck
/** @jsxImportSource solid-js */
import { Button } from "./button"

export default {
  title: "UI/Button",
  component: Button,
  args: {
    children: "Button",
    variant: "secondary",
    size: "normal",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost"],
    },
    size: {
      control: "select",
      options: ["small", "normal", "large"],
    },
    icon: {
      control: "select",
      options: ["none", "check", "plus", "arrow-right"],
      mapping: {
        none: undefined,
      },
    },
  },
}

export const Primary = {
  args: {
    variant: "primary",
  },
}

export const Secondary = {}

export const Ghost = {
  args: {
    variant: "ghost",
  },
}

export const WithIcon = {
  args: {
    children: "Continue",
    icon: "arrow-right",
  },
}

export const Disabled = {
  args: {
    variant: "primary",
    disabled: true,
  },
}
