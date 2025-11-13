Click https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-IQ4_XS.gguf?download=true
Download the model
Drop it in your Writingway/models folder

## Running tests

This project includes a small test harness (smoke, unit, and UI tests) to help keep refactors safe.

Prerequisites
- Node.js (recommended >= 16)
- The UI tests use Playwright (included as a devDependency). If you run into missing browsers, run `npx playwright install`.
- If you want generation tests to exercise the real model, start the local AI server (the project expects it at `http://localhost:8080`). You can start the provided server with `start.bat` on Windows.

Available test scripts (run from the project root):

```powershell
npm run smoke    # quick smoke: loads the page and checks key selectors
npm run unit     # unit tests (e.g., Generation.buildPrompt)
npm run ui       # runs the UI tests (headless)
npm test         # runs smoke, unit, then ui in sequence
```

Notes
- The repository vendors Alpine locally at `src/vendor/alpine.min.js` so tests can run offline.
- UI tests run headless and are written to prefer calling the app's handlers and to fall back to Dexie DB operations and stubbed generation when the AI server is not available.
- Do not remove the model download instructions above — the model binary is large and must be downloaded separately.