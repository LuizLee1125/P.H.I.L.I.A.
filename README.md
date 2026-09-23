# J.A.R.V.I.S. Desktop Voice Assistant

A local, intelligent desktop assistant built in **Node.js** and **TypeScript**, powered by **Google Gemini** for reasoning, speech-to-text, and speech synthesis, with **Playwright** browser automation and strict system guardrails.

---

## Architecture

```mermaid
flowchart LR
    A[Mic Stream: PvRecorder] --> B[Wake Word: Porcupine 'JARVIS']
    B -- keyword detected --> C[Record Command Clip / VAD]
    C --> D[Speech-to-Text: Gemini]
    D --> E[Gemini Brain + Tools]
    E -- function call --> F[Filesystem Tools: search, read, metadata, open]
    F --> E
    E -- function call --> J[Browser Automation: Playwright]
    J --> E
    E --> H[Text-to-Speech: Gemini]
    H --> I[Speaker Playback: sound-play / PCM WAV]
```

---

## Key Features

1. **Dual Interaction Modes**:
   - **Voice Mode**: Always-listening for the wake word **"JARVIS"** using `@picovoice/porcupine-node` and `@picovoice/pvrecorder-node`. Once detected, records your voice command until pause/silence (Voice Activity Detection), transcribes it via Gemini STT, executes your request, and speaks the reply aloud.
   - **Interactive CLI Mode**: You can also type commands directly into the terminal (`Jarvis ❯ `) at any time. Ideal for quiet environments or when working without a microphone.
2. **Phase 1 System & App Tools**:
   - `searchFiles(query, root?)`: Searches for files, defaulting to user home directory.
   - `getFileMetadata(path)`: Retrieves size, creation, modification, and access timestamps.
   - `readFileContent(path, maxChars)`: Reads plain text content safely, refusing binary files.
   - `openFile(path)`: Opens any safe local file with the OS default application.
   - `openApplication(name)`: Launches desktop applications (e.g. `notepad`, `calc`, `chrome`).
3. **Element-Map Web Browsing (Playwright)**:
   - Dedicated browser profile (`browser_profile/`) launched headed by default.
   - `browserOpen(url)`, `browserSearch(query)`: Navigates and enumerates visible interactive elements into numbered tags (`[1]`, `[2]`, ...).
   - `browserClick(ref)`, `browserType(ref, text, pressEnter)`: Interacts with elements by numeric reference.
   - `browserReadPage()`: Reads page content and returns updated element tags.
   - **Guardrails**: Automatically detects login, password, checkout, and payment pages, pausing for explicit user confirmation before executing any sensitive action.
4. **Natural Voice TTS**:
   - Speaks replies aloud using Gemini's native audio generation with prebuilt voices (default: `Fenrir`).
5. **Phase 2 Safe Write & Trash Deletion (`filesWrite.ts`)**:
   - Modularized `writeFileContent` and `deleteFile`.
   - Uses `trash` to send files to the OS Recycle Bin instead of permanent deletion (`never` `fs.unlink`).
   - Requires explicit terminal confirmation before modifying or deleting.
   - *Note: Phase 2 tools are intentionally modularized and kept out of the active Phase 1 brain tool list until Phase 1 read/open operations have run reliably in production.*

---

## Environment Variables (`.env`)

Your `.env` file is automatically ignored by Git (`.gitignore`). Configure the following variables:

| Variable | Description | Default |
|---|---|---|
| `GEMINI_API_KEY` | Your Google Gemini API Key | *(Required)* |
| `GEMINI_MODEL` | Gemini model name for brain reasoning and STT | `gemini-3.5-flash-lite` |
| `GEMINI_VOICE` | Voice name for TTS (`Fenrir`, `Puck`, `Aoede`, `Charon`, `Kore`) | `Fenrir` |
| `PICOVOICE_ACCESS_KEY` | Picovoice AccessKey for offline "JARVIS" wake-word | *(Optional for CLI, required for hands-free voice)* |
| `BROWSER_HEADLESS` | Run Playwright browser headless (`true` or `false`) | `false` |
| `EXTRA_DENY_LIST` | Semicolon or comma-separated additional directories to protect | *(None)* |

---

## Filesystem Guardrails (Deny-List)

To prevent accidental modification or inspection of critical system files, Jarvis enforces an active deny-list before any filesystem access:
- **Windows**: `C:\Windows` (including `System32`), `C:\Program Files`, `C:\Program Files (x86)`.
- **macOS**: `/System`, `/Library`, `/usr`, `/bin`, `/sbin`, `/private`.
- **Linux**: `/etc`, `/bin`, `/sbin`, `/usr`, `/boot`, `/lib`, `/proc`, `/sys`, `/dev`.

Attempting to touch a deny-listed directory immediately aborts the operation with a security guardrail exception.

---

## Setup & Running

### 1. Install Dependencies
```bash
npm install
```

### 2. Install Playwright Chromium
```bash
npx playwright install chromium
```

### 3. Configure `.env`
Ensure your `.env` contains:
```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
PICOVOICE_ACCESS_KEY=your_free_picovoice_key_here
```
*(Get a free Picovoice key at https://console.picovoice.ai/ for wake-word support).*

### 4. Run Automated Tests
Verify all tools, guardrails, and Gemini connections:
```bash
npm test
```

### 5. Launch Jarvis
```bash
npm start
```

---

## Example Interactions

Once started, say **"JARVIS"** or type directly at the prompt:

```text
Jarvis ❯ search files for package.json
Jarvis ❯ what is the size of package.json?
Jarvis ❯ open application notepad
Jarvis ❯ search the web for latest breakthroughs in AI
Jarvis ❯ exit
```
