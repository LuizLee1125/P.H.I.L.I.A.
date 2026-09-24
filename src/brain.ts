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

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/**
 * Phase 1 Function Declarations for Gemini
 */
const filesToolDeclarations: FunctionDeclaration[] = [
  {
    name: "searchFiles",
    description: "Search for files matching a query starting from a root directory (defaults to user's home directory). Always checks against system deny-list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Filename, keyword, or extension to search for",
        },
        root: {
          type: Type.STRING,
          description: "Optional root directory path to start searching from (defaults to user home directory)",
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
          description: "Maximum characters to read (optional, default 10,000)",
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
    description: "Open or launch a desktop application by name (e.g. 'notepad', 'calc', 'chrome', 'code').",
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

// Phase 1 tools bundled
const allTools = [
  {
    functionDeclarations: [
      ...filesToolDeclarations,
      ...appsToolDeclarations,
      ...browserToolDeclarations,
    ],
  },
];

/**
 * Execute a named tool with provided arguments
 */
async function executeTool(name: string, args: Record<string, any>): Promise<any> {
  console.log(`\n[Philia Tool Call] 🛠️ Executing: ${name}(${JSON.stringify(args)})`);

  try {
    switch (name) {
      // File tools
      case "searchFiles":
        return await searchFiles(args.query, args.root);
      case "getFileMetadata":
        return await getFileMetadata(args.path);
      case "readFileContent":
        return await readFileContent(args.path, args.maxChars);

      // App tools
      case "openFile":
        return await openFile(args.path);
      case "openApplication":
        return await openApplication(args.name);

      // Browser tools
      case "browserOpen":
        return await browserOpen(args.url);
      case "browserSearch":
        return await browserSearch(args.query);
      case "browserClick":
        return await browserClick(Number(args.ref));
      case "browserType":
        return await browserType(Number(args.ref), args.text, Boolean(args.pressEnter));
      case "browserReadPage":
        return await browserReadPage();

      default:
        throw new Error(`Tool "${name}" is not recognized or permitted.`);
    }
  } catch (err: any) {
    console.error(`[Philia Tool Error] ❌ Error executing "${name}":`, err.message || err);
    return {
      error: true,
      message: err.message || String(err),
    };
  }
}

const SYSTEM_INSTRUCTION = `You are Philia (P.H.I.L.I.A. — Precise Holographic Intelligence and Logical Interface Assistant), a highly capable, articulate, and reliable desktop AI assistant.
You help the user interact with their computer, inspect and locate files, launch applications, and browse the web.

Key principles:
1. Always be concise, helpful, and polite. If asked your name or identity, state that you are Philia, which stands for Precise Holographic Intelligence and Logical Interface Assistant.
2. Safety & Guardrails: Critical OS directories are protected. Never attempt to circumvent safety boundaries.
3. For web browsing, always use browserSearch or browserOpen first, observe the numbered interactive elements ([1], [2], etc.), and use browserClick or browserType by ref.
4. When a task completes, summarize what you did in a clear, natural sentence.`;

export class PhiliaBrain {
  private chat: any = null;
  private currentModel: string;

  constructor(model: string = config.geminiModel) {
    this.currentModel = model;
    this.initChat();
  }

  private initChat() {
    this.chat = ai.chats.create({
      model: this.currentModel,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: allTools,
        temperature: 0.4,
      },
    });
  }

  /**
   * Process a user utterance or query through the multi-turn tool calling loop
   */
  async process(prompt: string): Promise<string> {
    if (!this.chat) {
      this.initChat();
    }

    console.log(`\n[Philia Brain] 🧠 Processing: "${prompt}" (Model: ${this.currentModel})`);

    let response: any;
    try {
      response = await this.chat.sendMessage({ message: prompt });
    } catch (err: any) {
      // If primary model has high demand (503), attempt fallback
      if (err.message && err.message.includes("503") && this.currentModel !== "gemini-3.5-flash-lite") {
        console.warn(`[Philia Brain] ⚠️ Model ${this.currentModel} busy, falling back to gemini-3.5-flash-lite...`);
        this.currentModel = "gemini-3.5-flash-lite";
        this.initChat();
        response = await this.chat.sendMessage({ message: prompt });
      } else {
        throw err;
      }
    }

    // Tool calling loop
    const maxIterations = 10;
    let iteration = 0;

    while (response.functionCalls && response.functionCalls.length > 0 && iteration < maxIterations) {
      iteration++;
      const toolResponses = [];

      for (const call of response.functionCalls) {
        const result = await executeTool(call.name, call.args || {});
        toolResponses.push({
          functionResponse: {
            name: call.name,
            response: { output: result },
            id: call.id,
          },
        });
      }

      console.log(`[Philia Brain] 🔄 Sending tool output back to Gemini (step ${iteration})...`);
      response = await this.chat.sendMessage({ message: toolResponses });
    }

    const finalAnswer = response.text || "Task completed.";
    console.log(`[Philia Brain] 💬 Reply: ${finalAnswer}\n`);
    return finalAnswer;
  }
}

// Backwards-compatibility alias
export const JarvisBrain = PhiliaBrain;
export type JarvisBrain = PhiliaBrain;
