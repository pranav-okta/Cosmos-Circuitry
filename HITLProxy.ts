#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import * as readlineSync from "readline-sync";

type TransportMap = Record<string, StdioClientTransport>;

type MCPServerConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
  HighRiskTools: string[];
  BlockedTools: string[];
};

const mcpClient = new Client(
  {
    name: "HITL-client",
    version: "1.0.0",
  },
  {
    capabilities: {},
  },
);

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  // other properties like annotations, outputSchema (optional)
}

/**
 * Todo MCP Server
 * A server for managing todos with create, update, and list functionality
 */
class HITLProxy {
  private server: Server;
  private readonly downstreamServerName: string; // <-- 1. New readonly instance property
  private downstreamClient: Client;

  private static readonly MCPServerMap: Record<string, MCPServerConfig> = {
    // "todo-mcp-server": {
    //   // <--- This is now a simple object
    //   command: "/usr/local/bin/node",
    //   args: [
    //     "/Users/phil.whipps/Documents/repos/MCP_NODocker/packages/agent0/dist/mcp-server/todo-mcp-server-http.js",
    //   ],
    //   env: { COOKIE: `${process.env.COOKIE}` },
    //   HighRiskTools: ["add_todos"],
    //   BlockedTools: ["welcome_to_okta"],
    // },
    //
    // https://github.com/okta/okta-mcp-server
    "okta-mcp-server": {
      command: "/Users/pranav.rathinakumar/.ocm/shims/uv",
      args: [
        "run",
        "--directory",
        "/Users/pranav.rathinakumar/okta/okta-mcp-server",
        "okta-mcp-server",
      ],
      env: {
        OKTA_ORG_URL: "", // The Okta Org URL
        OKTA_CLIENT_ID: "", // The Okta Client ID
        OKTA_SCOPES:
          "okta.users.read okta.users.manage okta.groups.read okta.groups.manage okta.logs.read okta.policies.read okta.policies.manage okta.apps.read okta.apps.manage",
      },
      HighRiskTools: ["list_users", "delete_user", "create_user"],
      BlockedTools: ["system_admin"],
    },
  };

  public static async create(serverName: string): Promise<HITLProxy> {
    const instance = new HITLProxy(serverName);
    await instance.initializeDownstreamConnection();
    return instance;
  }

  private constructor(MCPServerName: string) {
    // const currentServerName = MCPServerName;
    this.downstreamServerName = MCPServerName;

    this.downstreamClient = new Client(
      {
        name: `${MCPServerName}-client`,
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    this.server = new Server(
      {
        name: MCPServerName,
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupToolHandlers();
    this.setupErrorHandler();
  }

  private async initializeDownstreamConnection(): Promise<void> {
    const config = HITLProxy.MCPServerMap[this.downstreamServerName];
    if (!config) {
      throw new Error(
        `Transport config for ${this.downstreamServerName} not found.`,
      );
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...config.env }).filter(
          ([_, value]) => value !== undefined,
        ),
      ) as Record<string, string>,
    });

    console.log(
      `[HITLProxy] Establishing persistent connection to ${this.downstreamServerName}`,
    );
    console.log(`[HITLProxy] Command: ${config.command}`);
    console.log(`[HITLProxy] Args: ${JSON.stringify(config.args)}`);
    console.log(`[HITLProxy] Env: ${JSON.stringify(config.env)}`);

    // Connect ONCE and keep the connection live for the lifetime of the proxy
    try {
      await this.downstreamClient.connect(transport);
      console.log("Downstream client connected successfully!");
    } catch (error) {
      console.error("Failed to connect to downstream server:", error);
      throw error;
    }
  }

  private async getTools(): Promise<ToolDefinition[]> {
    try {
      console.log(
        `[HITLProxy] Listing tools from ${this.downstreamServerName}`,
      );

      const toolsResult = await this.downstreamClient.listTools();
      return toolsResult.tools as ToolDefinition[];
    } catch (error) {
      console.error("Failed to list tools:", error);
    }
    return [];
  }

  private async callTool(toolName: string, toolargs: any): Promise<any> {
    const config = HITLProxy.MCPServerMap[this.downstreamServerName];
    if (!config) return null;

    // Check if tools is blocked
    if (config.BlockedTools?.includes(toolName)) {
      console.error(`❌ Access to ${toolName} has been blocked.`);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `❌ Access to ${toolName} has been blocked.`,
          },
        ],
      };
    }

    // Check if tool is High Risk
    if (config.HighRiskTools?.includes(toolName)) {
      // Get Human-in-the-Loop Approval
      const approved = await this.getHumanApproval(toolName, toolargs);
      if (!approved) {
        console.error(`❌ Human approval denied for ${toolName}`);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `❌ Human approval denied for high-risk tool: ${toolName}`,
            },
          ],
        };
      }
      console.log(`✅ Human approval granted for ${toolName}`);
    }

    // Log all tool calls for monitoring
    this.logToolCall(toolName, toolargs);

    try {
      console.log(
        `[HITLProxy] Calling tool ${toolName} on ${this.downstreamServerName}`,
      );

      const toolsResult = await this.downstreamClient.callTool({
        name: toolName,
        arguments: toolargs,
      });
      return toolsResult;
    } catch (error) {
      console.error("Tool call failed:", error);
    }
    return null;
  }

  private setupToolHandlers(): void {
    console.log("Setting up tools...");
    // Handle list tools request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.log(
        `[HITLProxy] Call List Tools for ${this.downstreamServerName}`,
      );
      const downstreamTools = await this.getTools();
      return { tools: downstreamTools };
    });

    // Handle tool call request
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.log(
        `[HITLProxy] Call Tool ${name} for ${this.downstreamServerName}`,
      );
      return this.callTool(name, args);
    });
  }

  private async getHumanApproval(
    toolName: string,
    toolargs: any,
  ): Promise<boolean> {
    console.log(`\n🚨 HIGH-RISK TOOL DETECTED: ${toolName}`);
    console.log(`📋 Tool Arguments:`, JSON.stringify(toolargs, null, 2));
    console.log(`🔧 Downstream Server: ${this.downstreamServerName}`);

    const approval = readlineSync.question(
      "\n❓ Do you approve this tool call? (y/N): ",
    );
    return approval.toLowerCase() === "y" || approval.toLowerCase() === "yes";
  }

  private logToolCall(toolName: string, toolargs: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      server: this.downstreamServerName,
      tool: toolName,
      arguments: toolargs,
    };

    console.log(
      `📝 [${timestamp}] Tool Call: ${toolName} on ${this.downstreamServerName}`,
    );

    // In a real implementation, you might want to write this to a file or database
    // For now, we'll just log to console
  }

  private setupErrorHandler(): void {
    this.server.onerror = (error) => {
      console.error("[HITL Proxy Error]", error);
    };

    process.on("SIGINT", async () => {
      console.log("\nShutting down Todo MCP Server...");
      await this.server.close();
      await this.downstreamClient.close();
      process.exit(0);
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // This will never resolve - the server runs indefinitely
    console.error("Todo MCP Server running on stdio");
  }
}

var MCPServername = "MCPServer";
if (process.argv.length > 2) {
  MCPServername = process.argv[2] || "MCPServer";
}

// Create and run the server
//const server = new HITLProxy(MCPServername);
HITLProxy.create(MCPServername)
  .then((serverInstance) => {
    // 2. Run the main server loop
    return serverInstance.run();
  })
  .catch((error: any) => {
    console.error("Failed to run HITL Proxy:", error);
    process.exit(1);
  });
