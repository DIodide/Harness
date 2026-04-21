/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as commands from "../commands.js";
import type * as conversations from "../conversations.js";
import type * as files from "../files.js";
import type * as harnesses from "../harnesses.js";
import type * as mcpOAuthTokens from "../mcpOAuthTokens.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as sandboxes from "../sandboxes.js";
import type * as seed from "../seed.js";
import type * as skills from "../skills.js";
import type * as usage from "../usage.js";
import type * as userSettings from "../userSettings.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  commands: typeof commands;
  conversations: typeof conversations;
  files: typeof files;
  harnesses: typeof harnesses;
  mcpOAuthTokens: typeof mcpOAuthTokens;
  messages: typeof messages;
  migrations: typeof migrations;
  sandboxes: typeof sandboxes;
  seed: typeof seed;
  skills: typeof skills;
  usage: typeof usage;
  userSettings: typeof userSettings;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
