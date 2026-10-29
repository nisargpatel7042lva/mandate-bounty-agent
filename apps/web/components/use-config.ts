"use client";

import { getConfig } from "../lib/config.ts";

const result = getConfig();

export function useConfig() {
  return result;
}
