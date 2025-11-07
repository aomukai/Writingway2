const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const projectRoot = path.resolve(__dirname, '..');
  const fileUrl = 'file:///' + path.join(projectRoot, 'main.html').replace(/\\/g, '/');

  console.log('Opening:', fileUrl);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => { try { console.log(`PAGE LOG [${msg.type()}] ${msg.text()}`); } catch (e) { } });
  page.on('pageerror', err => { console.error('PAGE ERROR', err && err.message ? err.message : err); });

  try {
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 15000 });
    await page.waitForSelector('.app-container, .welcome-screen', { timeout: 10000 });

    // Seed minimal project structure
    const proj = await page.evaluate(async () => await window.__test.seedProject('SaveTest'));
    const chap = await page.evaluate(async (args) => await window.__test.seedChapter(args.pid, 'C1'), { pid: proj.id });
    const scene = await page.evaluate(async (args) => await window.__test.seedScene(args.pid, args.cid, 'S1'), { pid: proj.id, cid: chap.id });

    // Instead of relying on the Alpine app loading UI state in headless runs,
    // call the Save utility directly with a minimal fake app object bound to the same DB.
    await page.evaluate(async (args) => {
      const sid = args.sid;
      const cid = args.cid;
      // create a minimal app-like object expected by Save.saveScene
      const fakeApp = {
        db: db,
        currentScene: {
          id: sid,
          title: 'S1',
          order: 0,
          chapterId: cid,
          content: 'Hello from test save',
          povCharacter: '',
          pov: '',
          tense: ''
        },
        chapters: [],
        scenes: []
      };
      // call the extracted save helper directly
      if (window.Save && typeof window.Save.saveScene === 'function') {
        await window.Save.saveScene(fakeApp);
      } else if (window.__test && typeof window.__test.callSave === 'function') {
        await window.__test.callSave();
      }
    }, { sid: scene.id, cid: chap.id });

    // Verify DB content and wordCount
    const saved = await page.evaluate(async (sid) => {
      const c = await db.content.get(sid);
      return { text: c ? c.text : null, wordCount: c ? c.wordCount : null };
    }, scene.id);

    if (!saved || saved.text !== 'Hello from test save') {
      console.error('Save failed or incorrect text:', saved);
      await browser.close();
      process.exit(2);
    }

    console.log('unit-saveScene test passed.');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('unit-saveScene test failed:', err && err.message ? err.message : err);
    await browser.close();
    process.exit(1);
  }
})();
