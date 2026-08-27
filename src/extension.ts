import type { ServerContext } from '@modelcontextprotocol/server';
import { ConversationHandleError, conversationHandleToolError } from './errors.js';
import {
  buildExecutionPlan,
  executePlan,
  sanitizeToolArgs,
} from './execution.js';
import type { ToolHandler, ToolInvocationResult } from './plugin-context.js';
import { presentHandle } from './presentation-resolver.js';
import { toExtensionSettings } from './sdk-meta.js';
import {
  DEFAULT_RETENTION_MS,
  type ConversationHandlePluginOptions,
  type PluginContext,
} from './plugin-context.js';
import {
  DEFAULT_HANDLE_LIFETIME_SECONDS,
  DEFAULT_MAX_HANDLE_BYTES,
  DEFAULT_ON_MISSING_HANDLE,
  EXTENSION_ID,
  type ServerExtensionSettings,
} from './schema/draft/schema.js';
import { InMemoryConversationStore } from './store.js';

export type {
  ConversationHandlePluginOptions,
  ToolHandler,
  ToolInvocationResult,
} from './plugin-context.js';
export type { ConversationStore } from './store.js';
export { getActiveConversation } from './active-context.js';

function buildPluginContext(options: ConversationHandlePluginOptions): PluginContext {
  const store = options.store ?? new InMemoryConversationStore();
  const nowMs = options.now ?? (() => Date.now());
  const settings: ServerExtensionSettings = {
    handleLifetimeSeconds: options.settings?.handleLifetimeSeconds ?? DEFAULT_HANDLE_LIFETIME_SECONDS,
    onMissingHandle: options.settings?.onMissingHandle ?? DEFAULT_ON_MISSING_HANDLE,
    maxHandleBytes: options.settings?.maxHandleBytes ?? DEFAULT_MAX_HANDLE_BYTES,
    conversationRetentionSeconds: options.settings?.conversationRetentionSeconds,
    retentionMs:
      options.settings?.retentionMs ??
      (options.settings?.conversationRetentionSeconds !== undefined
        ? options.settings.conversationRetentionSeconds * 1000
        : undefined),
  };

  return {
    store,
    keys: options.keys,
    settings,
    stateCommitment: options.stateCommitment,
    resolvePrincipal: options.resolvePrincipal,
    resolveOnMissingHandle: options.resolveOnMissingHandle,
    nowMs,
    nowSec: () => Math.floor(nowMs() / 1000),
    activeKeyId: options.keys[0]?.keyId ?? 0,
  };
}

export function conversationHandlePlugin(options: ConversationHandlePluginOptions) {
  const ctx = buildPluginContext(options);
  const retentionMs = ctx.settings.retentionMs ?? DEFAULT_RETENTION_MS;

  async function invokeToolHandler(
    requestCtx: ServerContext,
    args: Record<string, unknown>,
    handler: ToolHandler,
  ): Promise<ToolInvocationResult> {
    const presentResult = presentHandle(ctx, requestCtx);
    if (!presentResult.ok) {
      return conversationHandleToolError(
        presentResult.failure.reason,
        presentResult.failure.message,
        presentResult.failure.code,
      );
    }

    const built = buildExecutionPlan(ctx, requestCtx, presentResult.presentation);
    if (!built.ok) {
      return built.result;
    }
    try {
      return await executePlan(ctx, built.plan, handler, sanitizeToolArgs(args));
    } catch (error) {
      if (error instanceof ConversationHandleError) {
        return error.toCallToolErrorResult();
      }
      throw error;
    }
  }

  function purgeExpiredConversations(): number {
    const cutoff = ctx.nowMs() - retentionMs;
    let purged = 0;
    for (const record of ctx.store.listRecords()) {
      if (record.createdAtMs < cutoff && !record.retired) {
        ctx.store.markRetired(record.cid);
        purged += 1;
      }
    }
    return purged;
  }

  return {
    extensionId: EXTENSION_ID,
    store: ctx.store,
    settings: ctx.settings,
    extensionSettings: () => toExtensionSettings(ctx.settings),
    invokeToolHandler,
    purgeExpiredConversations,
  };
}

export type ConversationHandleManager = ReturnType<typeof conversationHandlePlugin>;
