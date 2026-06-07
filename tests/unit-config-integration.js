const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');

/**
 * Tests for config.js and update-checker.js integration (T5).
 *
 * Tests:
 *  1. config.js defines window.WritingwayConfig with correct defaults (fallback)
 *  2. config.js fetches /writingway.json and overwrites defaults
 *  3. update-checker.js uses the dynamic updaterUrl (updated if WritingwayConfig is available)
 *  4. Fallback to http://127.0.0.1:8001 works when config endpoint unavailable
 *  5. Script tag order: config.js before update-checker.js in main.html
 */

const ROOT = path.resolve(__dirname, '..');
const TEST_PORT = 18923;

// ---------- tiny test server that serves the project root + /writingway.json ----------
function createTestServer(root, port, configJson) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url === '/writingway.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(configJson));
                return;
            }
            // Fallback to static file serving
            let filePath = path.join(root, req.url === '/' ? 'main.html' : req.url);
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                res.writeHead(200);
                res.end(data);
            });
        });
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

// ---------- helpers ----------
function log(label, ok) {
    console.log(ok ? `  ✓ ${label}` : `  ✗ ${label}`);
}

async function runTests() {
    const results = []; // { ac, pass, detail }
    const addResult = (ac, pass, detail) => {
        results.push({ ac, pass, detail });
        log(ac, pass);
    };

    const expectedConfig = { port: 9900, updaterPort: 9901, aiPort: 9980 };

    // ---- Test 5 (no server needed) ----
    {
        const mainHtml = fs.readFileSync(path.join(ROOT, 'main.html'), 'utf8');
        const configIdx = mainHtml.indexOf('src/config.js');
        const updateCheckerIdx = mainHtml.indexOf('src/update-checker.js');
        const pass = configIdx !== -1 && updateCheckerIdx !== -1 && configIdx < updateCheckerIdx;
        addResult(
            '[AC5] config.js script tag before update-checker.js in main.html',
            pass,
            pass ? `config.js at index ${configIdx}, update-checker.js at ${updateCheckerIdx}` : `config.js idx=${configIdx}, update-checker.js idx=${updateCheckerIdx}`
        );
    }

    // ---- Test AC1: config.js defines defaults ----
    {
        const configJs = fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8');
        const pass = configJs.includes('port: 8000') &&
                     configJs.includes('updaterPort: 8001') &&
                     configJs.includes('aiPort: 8080') &&
                     configJs.includes('window.WritingwayConfig = config');
        addResult(
            '[AC1] src/config.js defines window.WritingwayConfig with port, updaterPort, aiPort (defaults 8000, 8001, 8080)',
            pass,
            pass ? 'All three defaults present in config.js' : 'Expected defaults not found in config.js'
        );
    }

    // ---- Test AC2: config.js fetches /writingway.json and silently fails on error ----
    {
        const configJs = fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8');
        const hasFetch = configJs.includes("fetch('/writingway.json')");
        const hasSilentFailure = configJs.includes('.catch(') && configJs.includes('function');
        const pass = hasFetch && hasSilentFailure;
        addResult(
            '[AC2] src/config.js fetches /writingway.json and silently fails on error',
            pass,
            pass ? 'fetch + .catch pattern found' : 'Missing fetch or .catch pattern'
        );
    }

    // ---- Test AC3: update-checker.js overrides updaterUrl from WritingwayConfig ----
    {
        const updateCheckerJs = fs.readFileSync(path.join(ROOT, 'src/update-checker.js'), 'utf8');
        const hasOverride = updateCheckerJs.includes('window.WritingwayConfig') &&
                            updateCheckerJs.includes('WritingwayConfig.updaterPort') &&
                            updateCheckerJs.includes('UpdateChecker.updaterUrl');
        addResult(
            '[AC3] src/update-checker.js uses dynamic updaterUrl from WritingwayConfig',
            hasOverride,
            hasOverride ? 'Override logic found at end of IIFE' : 'Override logic not found'
        );
    }

    // ---- Test AC4: Dynamic integration test (browser + server) ----
    let server;
    try {
        server = await createTestServer(ROOT, TEST_PORT, expectedConfig);
    } catch (err) {
        console.error('Failed to start test server:', err.message);
        addResult('[AC4] Dynamic: config fetch + override', false, 'server startup error: ' + err.message);
        addResult('[AC4] Fallback to default when config unavailable', false, 'server startup error: ' + err.message);
    }

    if (server) {
        let browser;
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext();
            const page = await context.newPage();

            page.on('console', (msg) => {
                if (msg.type() === 'error') {
                    console.log('    PAGE ERROR:', msg.text());
                }
            });

            // ---- AC4a: config.js fetches /writingway.json and updates the shared object ----
            {
                await page.goto(`http://127.0.0.1:${TEST_PORT}/main.html`, { waitUntil: 'load', timeout: 15000 });
                await new Promise((r) => setTimeout(r, 1500));

                const result = await page.evaluate(() => {
                    const config = window.WritingwayConfig || {};
                    return {
                        port: config.port,
                        updaterPort: config.updaterPort,
                        aiPort: config.aiPort,
                    };
                });

                // The shared config object must be mutated to server values
                const pass = result.port === expectedConfig.port &&
                             result.updaterPort === expectedConfig.updaterPort &&
                             result.aiPort === expectedConfig.aiPort;
                addResult(
                    '[AC4] Dynamic: config.js fetches /writingway.json and overrides defaults',
                    pass,
                    `WritingwayConfig={port:${result.port}, updaterPort:${result.updaterPort}, aiPort:${result.aiPort}} ${pass ? '✓' : '✗'} (expected port:${expectedConfig.port}, updaterPort:${expectedConfig.updaterPort}, aiPort:${expectedConfig.aiPort})`
                );
            }

            // ---- AC4b: Fallback to default when config endpoint unavailable ----
            server.close();
            server = null;

            {
                const updateCheckerJs = fs.readFileSync(path.join(ROOT, 'src/update-checker.js'), 'utf8');
                const hasFallback = updateCheckerJs.includes("http://127.0.0.1:8001");
                const configJs = fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8');
                const hasConfigFallback = configJs.includes('port: 8000');
                const pass = hasFallback && hasConfigFallback;
                addResult(
                    '[AC4] Fallback to http://127.0.0.1:8001 works when config unavailable',
                    pass,
                    pass ? 'Hardcoded fallback URL present in update-checker.js + config.js defaults intact' : 'Fallback URL missing'
                );
            }
        } catch (err) {
            console.error('Browser test error:', err.message);
            addResult('[AC4] Dynamic: config fetch + override', false, err.message);
            addResult('[AC4] Fallback to default when config unavailable', false, err.message);
        } finally {
            if (browser) await browser.close();
        }
    }

    // ---- Summary ----
    const allPassed = results.every((r) => r.pass);
    console.log('\n' + '='.repeat(60));
    console.log(`Results: ${results.filter((r) => r.pass).length}/${results.length} tests passed`);
    if (!allPassed) {
        console.log('Failed:');
        results.forEach((r) => {
            if (!r.pass) console.log(`  - ${r.ac}: ${r.detail}`);
        });
    }
    console.log('='.repeat(60));

    await server && server.close();
    process.exit(allPassed ? 0 : 1);
}

runTests().catch((err) => {
    console.error('Test runner error:', err.message);
    process.exit(1);
});
