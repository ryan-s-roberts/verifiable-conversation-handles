import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { ConversationHandleManager, ToolHandler } from './extension.js';
import { EXTENSION_ID, type ToolHandleRequirement } from './schema/draft/schema.js';
import { buildToolHandleMeta } from './tool-meta.js';

export interface ConversationToolDefinition {
  description?: string;
  inputSchema: z.ZodTypeAny;
  handler: ToolHandler;
  /**
   * §1.1 `requirement`. Defaults to `preferred`.
   * Tools registered here always advertise `mayMint: true` because
   * {@link registerConversationTools} routes every call through handle mint/rotate.
   * Register conversation-agnostic tools with `mcp.registerTool` directly.
   */
  handleRequirement?: ToolHandleRequirement;
}

export function registerConversationTools(
  mcp: McpServer,
  manager: ConversationHandleManager,
  tools: Record<string, ConversationToolDefinition>,
): void {
  mcp.server.registerCapabilities({
    extensions: {
      [EXTENSION_ID]: manager.extensionSettings(),
    },
  });

  for (const [name, tool] of Object.entries(tools)) {
    const toolMeta = buildToolHandleMeta(tool.handleRequirement ?? 'preferred');

    mcp.registerTool(
      name,
      {
        description: tool.description ?? `Conversation tool: ${name}`,
        inputSchema: tool.inputSchema,
        _meta: toolMeta,
      },
      async (args, ctx) => {
        const result = await manager.invokeToolHandler(ctx, args as Record<string, unknown>, tool.handler);
        return {
          content: result.content,
          ...(result.isError ? { isError: true as const } : {}),
          ...(result._meta ? { _meta: result._meta } : {}),
        };
      },
    );
  }
}
