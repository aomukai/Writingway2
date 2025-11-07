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

        // Wait for app to render
        await page.waitForSelector('.app-container, .welcome-screen', { timeout: 10000 });

        // If no chapter exists after a short wait, seed a test project directly into Dexie and reload
        let hasChapter = await page.$('.chapter-item');
        if (!hasChapter) {
            try {
                // Wait briefly for app to possibly load chapters
                await page.waitForTimeout(800);
                hasChapter = await page.$('.chapter-item');
            } catch (e) { }
        }

        if (!hasChapter) {
            // Seed a project/chapter/scene directly using the page's Dexie `db` instance
            await page.evaluate(async () => {
                try {
                    const proj = { id: Date.now().toString(), name: 'AutoTest Project', created: new Date(), modified: new Date() };
                    await db.projects.add(proj);
                    const chap = { id: Date.now().toString() + '-c', projectId: proj.id, title: 'Chapter 1', order: 0, created: new Date(), modified: new Date() };
                    await db.chapters.add(chap);
                    const scene = { id: Date.now().toString() + '-s', projectId: proj.id, chapterId: chap.id, title: 'Scene 1', order: 0, created: new Date(), modified: new Date() };
                    await db.scenes.add(scene);
                    await db.content.add({ sceneId: scene.id, text: '', wordCount: 0 });
                    try { localStorage.setItem('writingway:lastProject', proj.id); } catch (e) { }
                } catch (err) {
                    // ignore
                }
            });

            // Reload the page so Alpine picks up the new project state
            await page.reload({ waitUntil: 'load' });
            // Debug: log current DB counts from the page context
            const counts = await page.evaluate(async () => {
                try {
                    const projects = await db.projects.toArray();
                    const chapters = await db.chapters.toArray();
                    const scenes = await db.scenes.toArray();
                    return { projects: projects.length, chapters: chapters.length, scenes: scenes.length };
                } catch (e) {
                    return { error: String(e) };
                }
            });
            console.log('DB counts after seeding:', counts);
            await page.waitForSelector('.chapter-item', { timeout: 8000 }).catch(() => { });
        }

        // Grab the first chapter item
        const firstChapter = await page.$('.chapter-item');
        if (!firstChapter) {
            console.error('No chapter items found after setup');
            await browser.close();
            process.exit(3);
        }

        const header = await firstChapter.$('.chapter-header');
        const caret = await firstChapter.$('.caret');
        const scenes = await firstChapter.$('.chapter-scenes');

        if (!header || !caret || !scenes) {
            console.error('Expected header, caret, and scenes elements to be present');
            await browser.close();
            process.exit(4);
        }

        const visibleBefore = await scenes.isVisible();
        const caretClassBefore = await caret.getAttribute('class');

        // Toggle expand/collapse
        await header.click();
        await page.waitForTimeout(250);

        const visibleAfter = await scenes.isVisible();
        const caretClassAfter = await caret.getAttribute('class');

        if (visibleBefore === visibleAfter) {
            console.error('Visibility did not toggle on chapter click');
            await browser.close();
            process.exit(5);
        }

        if (caretClassBefore === caretClassAfter) {
            console.error('Caret class did not change on toggle');
            await browser.close();
            process.exit(6);
        }

        console.log('UI sidebar test passed: chapter expand/collapse toggles scenes and caret rotates.');
        await browser.close();
        process.exit(0);
    } catch (err) {
        console.error('UI sidebar test failed:', err && err.message ? err.message : err);
        await browser.close();
        process.exit(1);
    }
})();
