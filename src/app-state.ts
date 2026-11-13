import type { AppTemplate, RetoolAppState } from "./retool-classic-export.js";
import { assertAppTemplate } from "./schema.js";
import { decodeTransit, encodeTransit, type Json, type TransitMeta } from "./transit.js";

const ROOT_TAG = "#iR:appTemplate";

/**
 * Decodes page.data.appState (layer 1) into RetoolAppState (layer 2). Meta pointers
 * are relative to appTemplate.
 */
export function decodeAppState(appState: string, what = "appState"): { state: RetoolAppState; meta: TransitMeta } {
  let decoded;
  try {
    decoded = decodeTransit(appState);
  } catch (err) {
    throw new Error(`${what} is not valid Transit: ${(err as Error).message}`);
  }
  const { value, meta } = decoded;
  if (meta.tags[""] !== ROOT_TAG) {
    throw new Error(`${what} is not an appTemplate Record (expected ["~#iR",["^ ","n","appTemplate","v",...]])`);
  }
  assertAppTemplate(value, what);
  return { state: { appTemplate: value }, meta };
}

export function encodeAppState(state: RetoolAppState, meta: TransitMeta, what = "appState"): string {
  assertAppTemplate(state.appTemplate, what);
  return encodeTransit(state.appTemplate as unknown as Json, {
    tags: { ...meta.tags, "": ROOT_TAG },
    order: meta.order,
  });
}

export type { AppTemplate };
