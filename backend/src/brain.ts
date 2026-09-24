import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import { config } from "./config.js";
import { searchFiles, getFileMetadata, readFileContent } from "./tools/files.js";
import { openFile, openApplication } from "./tools/apps.js";
import {
  browserOpen,
  browserSearch,
  browserClick,
  browserType,
  browserReadPage,
} from "./tools/browser.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const filesToolDeclarations: FunctionDeclaration[] = [
  {
    name: "searchFiles",
    description: "Search for files matching a query. Root can be 'desktop', 'downloads', 'documents', 'workspace', or an absolute directory path.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Filename, keyword, or extension to search for",
        },
        root: {
          type: Type.STRING,
          description: "Optional root directory path or alias ('desktop', 'downloads', 'documents', 'workspace')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "getFileMetadata",
    description: "Get file or folder metadata including size, modification time (mtime), access time (atime), and permissions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: "Absolute or relative path to the file or directory",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "readFileContent",
    description: "Read text content of a file up to maxChars (default 10,000). Refuses binary files.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: "Path to the file to read",
        },
        maxChars: {
          type: Type.INTEGER,
          description: "Maximum characters to read (default 10,000)",
        },
      },
      required: ["path"],
    },
  },
];

const appsToolDeclarations: FunctionDeclaration[] = [
  {
    name: "openFile",
    description: "Open a file on the user's computer with its default application. Guarded against denied system paths.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: "Path to the file to open",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "openApplication",
    description: "Open or launch a desktop application by name (e.g. 'notepad', 'calc', 'chrome', 'edge', 'code').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: "Name or executable of the application to launch",
        },
      },
      required: ["name"],
    },
  },
];

const browserToolDeclarations: FunctionDeclaration[] = [
  {
    name: "browserOpen",
    description: "Open or navigate the browser to a URL. Returns page title, URL, and a numbered map of interactive elements [1], [2], etc.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "The full web URL or domain to navigate to",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "browserSearch",
    description: "Perform a web search using the browser and return the numbered map of search results and interactive elements.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The search query to search the web for",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "browserClick",
    description: "Click an interactive element on the current page using its numeric reference [ref] from browserOpen or browserReadPage.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ref: {
          type: Type.INTEGER,
          description: "The numeric reference number of the element to click",
        },
      },
      required: ["ref"],
    },
  },
  {
    name: "browserType",
    description: "Type text into an input field or textarea identified by its numeric reference [ref].",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ref: {
          type: Type.INTEGER,
          description: "The numeric reference number of the input element",
        },
        text: {
          type: Type.STRING,
          description: "The text string to type into the field",
        },
        pressEnter: {
          type: Type.BOOLEAN,
          description: "Whether to press Enter after typing (useful for search bars)",
        },
      },
      required: ["ref", "text"],
    },
  },
  {
    name: "browserReadPage",
    description: "Inspect the current browser page, returning the page title, URL, readable text excerpt, and updated numeric element map.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

const allTools = [
  {
    functionDeclarations: [
      ...filesToolDeclarations,
      ...appsToolDeclarations,
      ...browserToolDeclarations,
    ],
  },
];

export interface StatusEvent {
  type: "thinking" | "tool_start" | "tool_done" | "reply" | "error";
  message: string;
  tool?: string;
  args?: any;
  result?: any;
}

export type StatusCallback = (event: StatusEvent) => void;

async function executeTool(
  name: string,
  args: Record<string, any>,
  onStatus?: StatusCallback
): Promise<any> {
  console.log(`\n[Philia Tool Call] 🛠️ Executing: ${name}(${JSON.stringify(args)})`);
  onStatus?.({
    type: "tool_start",
    tool: name,
    args,
    message: `Running ${name}...`,
  });

  try {
    let result: any;
    switch (name) {
      case "searchFiles":
        result = await searchFiles(args.query, args.root);
        break;
      case "getFileMetadata":
        result = await getFileMetadata(args.path);
        break;
      case "readFileContent":
        result = await readFileContent(args.path, args.maxChars);
        break;
      case "openFile":
        result = await openFile(args.path);
        break;
      case "openApplication":
        result = await openApplication(args.name);
        break;
      case "browserOpen":
        result = await browserOpen(args.url);
        break;
      case "browserSearch":
        result = await browserSearch(args.query);
        break;
      case "browserClick":
        result = await browserClick(Number(args.ref));
        break;
      case "browserType":
        result = await browserType(Number(args.ref), args.text, Boolean(args.pressEnter));
        break;
      case "browserReadPage":
        result = await browserReadPage();
        break;
      default:
        throw new Error(`Tool "${name}" is not recognized.`);
    }

    onStatus?.({
      type: "tool_done",
      tool: name,
      result,
      message: `Completed ${name}`,
    });

    return result;
  } catch (err: any) {
    console.error(`[Philia Tool Error] ❌ Error executing "${name}":`, err.message || err);
    onStatus?.({
      type: "error",
      tool: name,
      message: err.message || String(err),
    });
    return {
      error: true,
      message: err.message || String(err),
    };
  }
}

function buildSystemInstruction(): string {
  return `You are Philia (P.H.I.L.I.A. — Precise Holographic Intelligence and Logical Interface Assistant), a brilliant, articulate, and reliable desktop AI assistant.
Current Environment:
- Platform: ${process.platform}
- User Home: ${config.homeDir}
- Assistant Name: Philia (P.H.I.L.I.A.)
- Full Acronym: Precise Holographic Intelligence and Logical Interface Assistant

Behavior Guidelines:
1. Provide concise, polished, and natural answers suitable for voice synthesis and desktop chat.
2. If asked for your name or identity, state that you are Philia, which stands for Precise Holographic Intelligence and Logical Interface Assistant.
3. If asked to inspect or locate files, use searchFiles, getFileMetadata, or readFileContent.
4. If asked to open apps or web pages, use openApplication or browser tools.
5. When browsing the web, examine the numbered interactive elements ([1], [2], etc.) and interact by ref.
6. System guardrails strictly protect system files. Respect security constraints.
7. When summarizing actions, be direct and helpful.`;
}

export interface BrainProcessResult {
  reply: string;
  toolsUsed: Array<{ tool: string; args: any; result: any }>;
}

export class PhiliaBrain {
  private chat: any = null;
  private currentModel: string;
  private historyLength: number = 0;

  constructor(model: string = config.geminiModel) {
    this.currentModel = model;
    this.initChat();
  }

  private initChat() {
    this.chat = ai.chats.create({
      model: this.currentModel,
      config: {
        systemInstruction: buildSystemInstruction(),
        tools: allTools,
        temperature: 0.35, // Low temperature for high precision and fast tool dispatch
      },
    });
    this.historyLength = 0;
  }

  /**
   * Reset conversation memory
   */
  reset() {
    this.initChat();
  }

  /**
   * Send message with automatic retry for transient network errors or high demand spikes.
   */
  private async sendWithRetry(payload: any, maxRetries: number = 3): Promise<any> {
    let delay = 500;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.chat.sendMessage(payload);
      } catch (err: any) {
        const isTransient =
          err.message &&
          (err.message.includes("503") ||
           err.message.includes("fetch failed") ||
           err.message.includes("ECONNRESET") ||
           err.message.includes("ETIMEDOUT") ||
           err.message.includes("connection failed"));

        if (isTransient && attempt < maxRetries) {
          console.warn(`[Philia Brain] ⚠️ API request hiccup (${err.message}). Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`);
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }

        // Try model fallback if 503 persists
        if (err.message && err.message.includes("503") && this.currentModel !== "gemini-3.5-flash-lite") {
          console.warn(`[Philia Brain] ⚠️ Model ${this.currentModel} busy, switching to gemini-3.5-flash-lite...`);
          this.currentModel = "gemini-3.5-flash-lite";
          this.initChat();
          return await this.chat.sendMessage(payload);
        }

        throw err;
      }
    }
  }

  /**
   * Process user prompt with real-time status callbacks and tool loop
   */
  async process(
    prompt: string,
    onStatus?: StatusCallback
  ): Promise<BrainProcessResult> {
    if (!this.chat) {
      this.initChat();
    }

    console.log(`\n[Philia Brain] 🧠 Processing: "${prompt}" (Model: ${this.currentModel})`);
    onStatus?.({
      type: "thinking",
      message: "Analyzing request...",
    });

    const toolsUsed: Array<{ tool: string; args: any; result: any }> = [];

    let response = await this.sendWithRetry({ message: prompt });

    const maxIterations = 8;
    let iteration = 0;

    while (response.functionCalls && response.functionCalls.length > 0 && iteration < maxIterations) {
      iteration++;
      const toolResponses = [];

      for (const call of response.functionCalls) {
        const result = await executeTool(call.name, call.args || {}, onStatus);
        toolsUsed.push({ tool: call.name, args: call.args || {}, result });

        toolResponses.push({
          functionResponse: {
            name: call.name,
            response: { output: result },
            id: call.id,
          },
        });
      }

      console.log(`[Philia Brain] 🔄 Sending tool output back to Gemini (step ${iteration})...`);
      onStatus?.({
        type: "thinking",
        message: "Synthesizing tool results...",
      });

      response = await this.sendWithRetry({ message: toolResponses });
    }

    const finalAnswer = response.text || "Task complete.";
    console.log(`[Philia Brain] 💬 Reply: ${finalAnswer}\n`);

    onStatus?.({
      type: "reply",
      message: finalAnswer,
    });

    this.historyLength++;
    // Reset context every 25 turns to prevent context bloat and keep latency low
    if (this.historyLength > 25) {
      this.initChat();
    }

    return {
      reply: finalAnswer,
      toolsUsed,
    };
  }
}

// Backwards-compatibility alias
export const JarvisBrain = PhiliaBrain;
export type JarvisBrain = PhiliaBrain;
