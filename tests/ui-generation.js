const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const projectRoot = path.resolve(__dirname, '..');
    const fileUrl = 'file:///' + path.join(projectRoot, 'main.html').replace(/\\/g, '/');

    console.log('Opening:', fileUrl);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto(fileUrl, { waitUntil: 'load', timeout: 15000 });
        await page.waitForSelector('.app-container, .welcome-screen', { timeout: 10000 });

        // Ensure there's a scene; seed if necessary
        let hasScene = await page.$('.scene-item');
        if (!hasScene) {
            await page.evaluate(async () => {
                try {
                    const proj = { id: Date.now().toString(), name: 'GenTest', created: new Date(), modified: new Date() };
                    await db.projects.add(proj);
                    const chap = { id: Date.now().toString() + '-c', projectId: proj.id, title: 'Chapter 1', order: 0, created: new Date(), modified: new Date() };
                    await db.chapters.add(chap);
                    const scene = { id: Date.now().toString() + '-s', projectId: proj.id, chapterId: chap.id, title: 'Scene 1', order: 0, created: new Date(), modified: new Date() };
                    await db.scenes.add(scene);
                    await db.content.add({ sceneId: scene.id, text: '', wordCount: 0 });
                    try { localStorage.setItem('writingway:lastProject', proj.id); } catch (e) { }
                } catch (e) { }
            });
            await page.reload({ waitUntil: 'load' });
            await page.waitForSelector('.scene-item', { timeout: 8000 });
        }

        // Make app think AI is ready and stub the generation streamer
        await page.evaluate(() => {
            const el = document.querySelector('[x-data="app"]');
            if (el && el.__x && el.__x.$data) {
                el.__x.$data.aiStatus = 'ready';
            }

            // Stub streamGeneration to emit a few tokens with a tiny delay
            window.Generation = window.Generation || {};
            window.Generation.streamGeneration = async (prompt, onToken) => {
                const tokens = [' This', ' is', ' generated.'];
                for (const t of tokens) {
                    // small pause to simulate streaming
                    await new Promise(r => setTimeout(r, 30));
                    try { onToken(t); } catch (e) { }
                }
            };

            // Also provide a simple buildPrompt if missing
            window.Generation.buildPrompt = window.Generation.buildPrompt || function (beat, sceneContent, options) { return 'PROMPT'; };
        });

        // Select the first scene to load into the editor
        const firstScene = await page.$('.scene-item');
        await firstScene.click();
        await page.waitForTimeout(200);

        // Fill beat input and trigger generation
        await page.fill('.beat-input', "She opens the door and steps into the rain.");
        await page.click('.generate-btn');

        // Wait for Accept button to appear which indicates generation completed
        await page.waitForSelector('text=Accept', { timeout: 5000 });

        // Verify that generated tokens appear in the editor textarea
        const ta = await page.$('.editor-textarea');
        const value = await ta.evaluate(el => el.value);
        if (!value.includes('generated')) {
            console.error('Generated text not found in editor:', value.slice(0, 200));
            await browser.close();
            process.exit(3);
        }

        // Click Accept and verify actions disappear (wait until hidden)
        await page.click('text=Accept');
        try {
            await page.waitForSelector('text=Accept', { state: 'hidden', timeout: 3000 });
        } catch (e) {
            const isVis = await page.isVisible('text=Accept').catch(() => false);
            if (isVis) {
                console.error('Accept button still visible after accepting');
                await browser.close();
                process.exit(4);
            }
        }

        console.log('UI generation test passed: streaming stub appended text and Accept works.');
        await browser.close();
        process.exit(0);
    } catch (err) {
        console.error('UI generation test failed:', err && err.message ? err.message : err);
        await browser.close();
        process.exit(1);
    }
})();
