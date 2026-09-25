import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import { config } from "./config.js";
import { searchFiles, getFileMetadata, readFileContent } from "./tools/files.js";
import { writeFileContent, deleteFile } from "./tools/filesWrite.js";
import { openFile, openApplication } from "./tools/apps.js";
import { executeCommand } from "./tools/system.js";
import {
  grantFullAccess,
  isFullAccessGranted,
  getPermissionsState,
} from "./permissions.js";
import {
  browserOpen,
  browserSearch,
  browserClick,
  browserType,
  browserReadPage,
  getDefaultBrowserInfo,
} from "./tools/browser.js";
import { canvasDraw } from "./tools/canvas.js";
import { inspectScreen } from "./tools/screen.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const permissionsToolDeclarations: FunctionDeclaration[] = [
  {
    name: "grantFullAccess",
    description: "Grant Philia full access to the user's computer. Call this when the user says 'give it full access', 'grant full access', 'allow full access', 'yes' to permission requests, or asks to give Philia full computer access. This is granted once and remembered permanently ('never again').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: {
          type: Type.STRING,
          description: "Optional confirmation explanation or context",
        },
      },
    },
  },
  {
    name: "getAccessStatus",
    description: "Check whether Philia currently has full computer access.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

const systemToolDeclarations: FunctionDeclaration[] = [
  {
    name: "executeCommand",
    description: "Execute a shell or PowerShell command directly on the user's computer. Available with full computer access.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The shell command or PowerShell snippet to execute",
        },
      },
      required: ["command"],
    },
  },
];

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
  {
    name: "writeFileContent",
    description: "Write content to a file at filePath on the user's computer.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: "Path of the file to write",
        },
        content: {
          type: Type.STRING,
          description: "Text content to write into the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "deleteFile",
    description: "Safely move a file or folder to the OS Recycle Bin / Trash (undoable).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: "Path of the file to move to Recycle Bin",
        },
      },
      required: ["path"],
    },
  },
];

const appsToolDeclarations: FunctionDeclaration[] = [
  {
    name: "openFile",
    description: "Open a file on the user's computer with its default application.",
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
    description: "Open or launch ANY desktop application, game, website, URL, or browser (e.g. 'HoYoPlay', 'Discord', 'Steam', 'Spotify', 'Notepad', 'Calculator', 'Opera GX', 'browser', 'YouTube', 'Reddit', 'Google', 'https://...'). Always opens websites, web searches, and browser tasks in the user's default browser with the user's active logged-in account.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: "Name or URL of the application, website, domain, or browser to launch (e.g. 'HoYoPlay', 'Discord', 'YouTube', 'reddit.com', 'https://github.com', 'browser')",
        },
      },
      required: ["name"],
    },
  },
];

const browserToolDeclarations: FunctionDeclaration[] = [
  {
    name: "browserOpen",
    description: "Open a web URL in the user's default browser with their active logged-in account, and return page details and interactive elements.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "The full web URL or domain to open (e.g. 'https://youtube.com', 'reddit.com')",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "browserSearch",
    description: "Perform a web search in the user's default browser with their active logged-in account, returning search results and interactive elements.",
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

const canvasToolDeclarations: FunctionDeclaration[] = [
  {
    name: "canvasDraw",
    description: "Draw diagrams, circuits, shapes, and strokes directly on the desktop screen or MS Paint canvas. Automatically focuses Paint and renders complete electrical circuits (DC battery with +/- terminals, closed wire loop, resistor zigzag, switch, lamp/load, and ground), custom shapes, or continuous mouse strokes. Use this whenever the user asks to draw on Paint, sketch circuits, or create diagrams.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "Drawing action: 'circuit' (draws full electrical schematic circuit), 'strokes' (custom mouse paths), 'clear' (reset canvas)",
        },
        component: {
          type: Type.STRING,
          description: "Circuit component to draw: 'all' (entire circuit with all parts: battery, wires, resistor, switch, load, ground), 'battery', 'resistor', 'switch', 'load', 'ground', 'wires'",
        },
      },
      required: ["action"],
    },
  },
];

const screenToolDeclarations: FunctionDeclaration[] = [
  {
    name: "inspectScreen",
    description: "Capture a screenshot and visually read/inspect what is currently on the user's computer screen/desktop using real-time multimodal vision. Call this whenever the user asks 'what is on my screen?', 'can you read my screen?', 'look at my screen', 'what am I looking at?', 'read the text/code on my screen', 'diagnose this error on my screen', or asks about any open windows, apps, diagrams, or content displayed on their monitor.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Optional specific question or prompt about what to inspect on screen (e.g. 'What error is shown?', 'Read the code in the editor', 'What apps are open?')",
        },
      },
    },
  },
];

const allTools = [
  {
    functionDeclarations: [
      ...permissionsToolDeclarations,
      ...systemToolDeclarations,
      ...filesToolDeclarations,
      ...appsToolDeclarations,
      ...browserToolDeclarations,
      ...canvasToolDeclarations,
      ...screenToolDeclarations,
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
      case "grantFullAccess":
        result = grantFullAccess();
        break;
      case "getAccessStatus":
        result = {
          fullAccessGranted: isFullAccessGranted(),
          state: getPermissionsState(),
        };
        break;
      case "executeCommand":
        result = await executeCommand(args.command);
        break;
      case "writeFileContent":
        result = await writeFileContent(args.path, args.content);
        break;
      case "deleteFile":
        result = await deleteFile(args.path);
        break;
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
      case "canvasDraw":
        result = await canvasDraw(args);
        break;
      case "inspectScreen":
        result = await inspectScreen(args.query, (status) => {
          onStatus?.({
            type: "thinking",
            tool: "inspectScreen",
            message: status,
          });
        });
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

/**
 * Detect if the user's spoken or typed prompt asks Philia to inspect or check their screen.
 * Triggers on natural phrases like "at my screen", "look at my screen", "what's on my screen", etc.
 */
export function isScreenInspectionRequest(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  if (
    lower.includes("at my screen") ||
    lower.includes("on my screen") ||
    lower.includes("at the screen") ||
    lower.includes("on the screen")
  ) {
    return true;
  }

  if (
    lower.includes("my display") ||
    lower.includes("my monitor") ||
    lower.includes("my screen") ||
    lower.includes("the screen")
  ) {
    if (
      /look|see|check|read|inspect|view|what|describe|tell|summarize|diagnose|error|show|glance/i.test(lower)
    ) {
      return true;
    }
  }

  return /(?:at|on|check|read|look|see|inspect|view|summarize|diagnose|examine)\s+(?:what(?:'s|\s+is)\s+)?(?:on\s+)?(?:my|the|this)?\s*(?:screen|display|monitor)/i.test(lower);
}

function buildSystemInstruction(): string {
  const fullAccess = isFullAccessGranted();
  const browserInfo = getDefaultBrowserInfo();
  return `You are Philia (P.H.I.L.I.A. — Precise Holographic Intelligence and Logical Interface Assistant), a brilliant, articulate, and reliable desktop AI assistant.
Current Environment:
- Platform: ${process.platform}
- User Home: ${config.homeDir}
- Assistant Name: Philia (P.H.I.L.I.A.)
- Full Acronym: Precise Holographic Intelligence and Logical Interface Assistant
- Computer Full Access: ${fullAccess ? "ENABLED (Unrestricted)" : "RESTRICTED (Requires User Grant)"}
- User Default Browser: ${browserInfo.name} (${browserInfo.executablePath || "Default OS Handler"})

Core Directives:
1. FULL ACCESS & PERMISSION MANAGEMENT ("Ask first, never again"):
   - If the user asks to "give it full access", "grant full access to my computer", "enable full access", or confirms permission, call the grantFullAccess tool immediately.
   - Once full access is granted, it is permanently saved to disk and remembered across sessions ("never again"). Never ask the user for permission again once granted.
   - When full access is enabled, you have unrestricted access to all drives, folders, installed software, and shell command execution via executeCommand.
   - If full access has NOT yet been granted and the user commands an action requiring system-level permissions, ask the user if they wish to grant full access to their computer.

2. BROWSER & WEBSITES ("Always user default browser, always user active account"):
   - CRITICAL REQUIREMENT FOR ANY BROWSER-RELATED TASK:
     When doing ANY browser-related task (opening websites, opening the browser, searching the web, navigating to URLs, opening YouTube, Reddit, Google, Twitter/X, social media, web apps, etc.):
     1. It MUST open the DEFAULT BROWSER of the user (${browserInfo.name}).
     2. It MUST open in the ACCOUNT THE USER IS IN, NOT a separate one. Never open an isolated, guest, blank, or separate browser profile.
   - When the user asks to open their browser or visit ANY website or URL (e.g. "open my browser", "open browser", "open YouTube", "open Google", "open Reddit", "go to github.com", "open twitter", "open netflix"), call openApplication or browserOpen with the name or URL. It will automatically open in the user's default browser (${browserInfo.name}) with their active logged-in account.
   - When the user asks to search the web or look up information (e.g. "search for the weather", "search youtube for lo-fi", "look up best restaurants", "search google for XYZ"), call browserSearch or openApplication. It immediately opens the search results in the user's default browser (${browserInfo.name}) in their active account.
   - When automated webpage inspection or content reading is needed, browserOpen and browserReadPage automatically inspect page content in the background while keeping the user's default browser in their active account.

3. APPLICATION & FILE LAUNCHING:
   - When the user asks to open or launch ANY desktop application, game, or software (e.g. "Open HoYoPlay", "Open Discord", "Open Steam", "Launch Calculator", "Open Spotify", "Start VS Code"), call openApplication immediately with the name.
   - When the user asks to open a specific file or document (e.g. "open notes.txt", "open resume.pdf", "open file X"), call openFile with the path or filename.
   - Do NOT run slow disk-crawling searches for applications. The openApplication tool resolves Desktop shortcuts, Start Menu shortcuts, system binaries, and game launchers with zero latency.

4. FILE OPERATIONS & WORKSPACE:
   - To inspect or locate files across directories, use searchFiles, getFileMetadata, or readFileContent.
   - To write or safely recycle files, use writeFileContent or deleteFile.

5. DRAWING & CANVAS GOAL COMPLETION POLICY:
   - When the user asks you to draw something (e.g. "Open paint and draw a simple circuit", "draw a circuit in Paint", "draw on canvas"):
     1. NEVER STOP EARLY. Do NOT stop after just launching Paint or drawing a single partial line. Continue executing until the complete drawing or requested goal is 100% finished.
     2. For "draw a simple circuit", the circuit MUST be drawn completely with all required elements:
        - DC Voltage Source / Battery (positive and negative plates with +/- polarity signs)
        - Connecting wires forming a complete closed circuit loop
        - Resistor (classic zigzag pattern)
        - Load or switch (e.g. lamp/LED or blade switch)
        - Ground symbol
     3. Use the canvasDraw tool with action: "circuit" and component: "all" to render the entire circuit onto the Paint canvas.
     4. Always keep drawing until the entire goal is met.

6. COMMUNICATION STYLE & LANGUAGE POLICY (STRICT ENGLISH-ONLY OUTPUT):
   - Provide concise, polished, and natural answers suitable for voice synthesis and holographic desktop chat.
   - If asked for your name or identity, state that you are Philia, which stands for Precise Holographic Intelligence and Logical Interface Assistant.
   - STRICT MULTILINGUAL UNDERSTANDING WITH ENGLISH-ONLY OUTPUT:
     1. Whenever the user speaks, asks questions, or gives instructions in ANY language other than English (e.g. Tagalog/Filipino, Spanish, Japanese, Mandarin/Chinese, French, German, Korean, Russian, Italian, Arabic, Portuguese, or mixed/code-switched dialects like Taglish):
        - You MUST fully comprehend, interpret, and understand their meaning, intent, instructions, and nuances in that other language.
        - You MUST execute any requested actions, tools, commands, or answers accurately based on their instructions.
        - You MUST ALWAYS AND EXCLUSIVELY REPLY IN ENGLISH.
     2. NEVER reply in the foreign language. Do NOT switch to or mirror the user's language. Even if the user greets you or prompts you in another language, every single sentence of your spoken and written reply MUST ALWAYS be 100% in English.

7. SCREEN PERCEPTION & VISION ("at my screen", "look at my screen", "what's on my screen"):
   - When the user says or types phrases like "at my screen", "look at my screen", "take a look at my screen", "what is currently on my screen", "check my screen", "read my screen", "see my screen", or asks any question about their screen/display/monitor, you MUST IMMEDIATELY call the inspectScreen tool.
   - This is purely conversational and seamless: the user does not need to click any button or type a specific command. Saying or typing "at my screen" triggers your desktop vision immediately.
   - NEVER tell the user that you cannot see their screen or that you do not have visual access. You possess real-time multimodal desktop vision through inspectScreen.
   - Base your answer directly on the visual analysis returned by inspectScreen and explain what you see with clarity and precision.`;
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

    const maxIterations = 30;
    let iteration = 0;
    let goalRetryCount = 0;
    let screenRetryCount = 0;
    const isDrawingGoal = /draw|circuit|paint|sketch|schematic|diagram/i.test(prompt);
    const isScreenGoal = isScreenInspectionRequest(prompt);

    while (iteration < maxIterations) {
      if (response.functionCalls && response.functionCalls.length > 0) {
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
        continue;
      }

      // Check if user request is a drawing goal that has not yet been satisfied
      const circuitDrawn = toolsUsed.some(
        (t) => t.tool === "canvasDraw" && (t.result?.isGoalMet || t.result?.success || t.args?.action === "circuit")
      );

      if (isDrawingGoal && !circuitDrawn && goalRetryCount < 3) {
        goalRetryCount++;
        iteration++;
        console.log(`[Philia Brain] 🎯 Goal in progress: drawing requested, but canvas has not been completed. Prompting brain to finish...`);
        onStatus?.({
          type: "thinking",
          message: "Continuing execution: completing the requested drawing on canvas...",
        });

        response = await this.sendWithRetry({
          message: `[System Goal Directive]: The user asked: "${prompt}". Paint is active, but the full drawing is not yet completed. You must NOT stop until the entire goal is met! Use the canvasDraw tool with action: "circuit" and component: "all" to render the complete circuit onto the canvas now.`,
        });
        continue;
      }

      // Check if user request is asking to inspect or check their screen, but inspectScreen has not been called yet
      const screenInspected = toolsUsed.some((t) => t.tool === "inspectScreen");
      if (isScreenGoal && !screenInspected && screenRetryCount < 2) {
        screenRetryCount++;
        iteration++;
        console.log(`[Philia Brain] 🖥️ Screen check requested: "${prompt}". Proactively executing inspectScreen...`);
        onStatus?.({
          type: "thinking",
          tool: "inspectScreen",
          message: "Checking your screen...",
        });

        const screenResult = await executeTool("inspectScreen", { query: prompt }, onStatus);
        toolsUsed.push({ tool: "inspectScreen", args: { query: prompt }, result: screenResult });

        response = await this.sendWithRetry({
          message: `[System Vision Directive]: The user asked/commanded: "${prompt}". Philia captured and visually analyzed what is currently on the user's screen.
Vision Inspection Analysis:
"""
${screenResult.analysis}
"""
Now, answer the user's request ("${prompt}") directly and articulately based on what is displayed on their screen.`,
        });
        continue;
      }

      // Goal is satisfied or no further tool calls requested
      break;
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
