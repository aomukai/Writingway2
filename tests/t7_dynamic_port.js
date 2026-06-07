#!/usr/bin/env node
/**
 * T7 Tests: Dynamic port references in app.js and main.html
 *
 * Run: node tests/t7_dynamic_port.js
 *
 * Acceptance criteria:
 *   AC1: src/app.js references configured app port from WritingwayConfig.
 *   AC2: main.html aiEndpoint input dynamically defaults from config.
 *   AC3: localStorage user overrides preserved — dynamic default only when no value exists.
 *   AC4: Direct file:// open of main.html shows fallback port 8080 without errors.
 *   AC5: No Alpine.js errors in browser console.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PASS = [];
const FAIL = [];

function readRelative(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(label, condition, detail) {
    if (condition) {
        PASS.push(label);
        console.log(`  ✓ ${label}`);
    } else {
        FAIL.push(label);
        console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    }
}

function countOccurrences(text, regex) {
    let matches = text.match(regex);
    return matches ? matches.length : 0;
}

function balancedParens(str) {
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '(') depth++;
        if (str[i] === ')') depth--;
        if (depth < 0) return false;
    }
    return depth === 0;
}

// Load files
const appJs = readRelative('src/app.js');
const mainHtml = readRelative('main.html');
const configJs = readRelative('src/config.js');

console.log('=== T7: Dynamic Port Config Tests ===\n');

// ── AC1: app.js dynamic port ─────────────────────────────────────
console.log('AC1 – src/app.js references configured app port');

assert(
    'Contains var _wwPort definition',
    /var _wwPort/.test(appJs),
    'not found'
);
assert(
    'Uses typeof guard for WritingwayConfig',
    /typeof window\.WritingwayConfig/.test(appJs),
    'not found'
);
assert(
    'Reads WritingwayConfig.port property',
    /WritingwayConfig\.port/.test(appJs),
    'not found'
);
assert(
    'Falls back to 8000 when config missing',
    /WritingwayConfig\.port\)\s*\?\s*window\.WritingwayConfig\.port\s*\:\s*8000/.test(appJs),
    'not found'
);
assert(
    'Template literal uses ${_wwPort}',
    /localhost:\$\{_wwPort\}/.test(appJs),
    'not found'
);
assert(
    '_wwPort defined before file:// check',
    appJs.indexOf('// Read the configured app port') < appJs.indexOf("window.location.protocol === 'file:'"),
    'wrong order'
);
{
    const blockStart = appJs.indexOf('// Detect if opened via file:// protocol');
    const blockEnd = appJs.indexOf('this.updateLoadingScreen(20', blockStart);
    const block = blockStart >= 0 ? appJs.slice(blockStart, blockEnd) : '';
    assert(
        'No hardcoded localhost:8000 in file-protocol block',
        block.length > 0 && !/localhost:8000/.test(block),
        'still has hardcoded 8000'
    );
    assert(
        'File-protocol block uses ${_wwPort}',
        block.length > 0 && /\$\{_wwPort\}/.test(block),
        'missing template reference'
    );
}

// ── AC2: main.html dynamic aiEndpoint default ────────────────────
console.log('\nAC2 – main.html aiEndpoint defaults from config');

assert(
    'Contains x-init with WritingwayConfig',
    /x-init=[^>]*WritingwayConfig/.test(mainHtml),
    'not found'
);
assert(
    'x-init assigns to aiEndpoint',
    /if \(!aiEndpoint\) aiEndpoint/.test(mainHtml),
    'not found'
);
assert(
    'x-init uses WritingwayConfig.aiPort',
    /WritingwayConfig\.aiPort/.test(mainHtml),
    'not found'
);
assert(
    'x-init falls back to 8080',
    /WritingwayConfig\.aiPort\s*\?\s*window\.WritingwayConfig\.aiPort\s*:\s*8080/.test(mainHtml),
    'not found'
);
assert(
    'Contains x-text on description paragraph',
    /x-text=[^>]*WritingwayConfig\.aiPort/.test(mainHtml),
    'not found'
);
assert(
    'x-text falls back to 8080',
    /x-text=[^>]*: 8080/.test(mainHtml),
    'not found'
);
assert(
    'Hardcoded value="http://localhost:8080" removed',
    !/value="http:\/\/localhost:8080"/.test(mainHtml),
    'still present'
);
assert(
    'Placeholder still shows localhost:8080',
    /placeholder="http:\/\/localhost:8080"/.test(mainHtml),
    'not found'
);
assert(
    'x-model="aiEndpoint" on input',
    /x-model="aiEndpoint"/.test(mainHtml),
    'not found'
);

// ── AC3: localStorage overrides preserved ────────────────────────
console.log('\nAC3 – localStorage user overrides preserved');

assert(
    'x-init guards with !aiEndpoint (not unconditional)',
    /x-init="if \(!aiEndpoint\)/.test(mainHtml),
    'not found'
);
assert(
    'main.html 8080 fallback when config unavailable',
    /WritingwayConfig\.aiPort\s*\?\s*window\.WritingwayConfig\.aiPort\s*:\s*8080/.test(mainHtml),
    'not found'
);
assert(
    'app.js 8000 fallback when config unavailable',
    /WritingwayConfig\.port\)\s*\?\s*window\.WritingwayConfig\.port\s*\:\s*8000/.test(appJs),
    'not found'
);

// ── AC4: file:// fallback shows 8080 without errors ──────────────
console.log('\nAC4 – file:// fallback port 8080 without errors');

assert(
    'main.html has typeof guard for WritingwayConfig',
    /typeof window\.WritingwayConfig/.test(mainHtml),
    'not found'
);
assert(
    'app.js has typeof guard for WritingwayConfig',
    /typeof window\.WritingwayConfig/.test(appJs),
    'not found'
);
assert(
    'placeholder includes localhost:8080 for visual consistency',
    /localhost:8080/.test(mainHtml),
    'not found'
);

// ── AC5: No Alpine.js errors in browser console ──────────────────
console.log('\nAC5 – Alpine.js x-init syntax is valid');

// Find the specific x-init on the aiEndpoint input (line ~1503 context)
const aiEndpointSection = mainHtml.match(/aiEndpoint.*?x-init="([^"]*)"/s);
const xInitMatch = aiEndpointSection ? { _0: 'x-init="' + aiEndpointSection[1] + '"', 1: aiEndpointSection[1] } : null;
assert(
    'x-init attribute exists on aiEndpoint input and is parseable',
    xInitMatch !== null && xInitMatch[1].length > 0,
    'not found or empty'
);
if (xInitMatch) {
    const xInitExpr = xInitMatch[1];
    assert(
        'x-init expression has balanced parentheses',
        balancedParens(xInitExpr),
        'unbalanced parens'
    );
    assert(
        'x-init expression starts with if',
        xInitExpr.trim().startsWith('if'),
        'starts with: ' + xInitExpr.trim().slice(0, 30)
    );
    assert(
        'x-init assigns to aiEndpoint',
        xInitExpr.includes('aiEndpoint'),
        'not found'
    );
}

const xTextMatches = mainHtml.match(/x-text="([^"]*)"/g);
assert(
    'x-text attribute exists and is parseable',
    xTextMatches !== null && xTextMatches.length > 0,
    'not found'
);
if (xTextMatches) {
    let allBalanced = true;
    for (const m of xTextMatches) {
        const inner = m.match(/x-text="([^"]*)"/);
        if (inner && !balancedParens(inner[1])) {
            allBalanced = false;
            break;
        }
    }
    assert(
        'All x-text expressions have balanced parentheses',
        allBalanced,
        'unbalanced'
    );
}

assert(
    'Alpine.js loaded in document',
    /alpine\.min\.js/.test(mainHtml),
    'not found'
);
assert(
    'x-data="app" on root element',
    /x-data="app"/.test(mainHtml),
    'not found'
);

// ── Integration: config.js ────────────────────────────────────────
console.log('\nIntegration – config.js WritingwayConfig shape');

assert(
    'config.js exposes window.WritingwayConfig',
    /window\.WritingwayConfig/.test(configJs),
    'not found'
);
assert(
    'config.js defines port default 8000',
    /port:\s*8000/.test(configJs),
    'not found'
);
assert(
    'config.js defines aiPort default 8080',
    /aiPort:\s*8080/.test(configJs),
    'not found'
);
assert(
    'config.js defines updaterPort default 8001',
    /updaterPort:\s*8001/.test(configJs),
    'not found'
);
assert(
    'config.js silently catches fetch errors',
    /\.catch\s*\(/.test(configJs),
    'not found'
);

// ── Summary ──────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`Passed: ${PASS.length}`);
console.log(`Failed: ${FAIL.length}`);

if (FAIL.length > 0) {
    console.log('\nFailures:');
    FAIL.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
} else {
    console.log('\nAll T7 acceptance criteria verified ✓');
    process.exit(0);
}
