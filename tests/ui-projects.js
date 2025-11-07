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

    // Seed two projects
    const projA = await page.evaluate(async () => await window.__test.seedProject('ProjA'));
    const projB = await page.evaluate(async () => await window.__test.seedProject('ProjB'));

    // Select project B using test helper
    const ok = await page.evaluate(async (id) => await window.__test.selectProject(id), projB.id);
    if (!ok) {
      console.error('selectProject helper failed');
      await browser.close();
      process.exit(2);
    }

    // Verify app state selectedProjectId or currentProject
    const state = await page.evaluate(() => {
      const a = window.__test.getApp();
      return { selectedProjectId: a.selectedProjectId, currentProjectId: a.currentProject ? a.currentProject.id : null, ls: localStorage.getItem('writingway:lastProject') };
    });

    if (state.selectedProjectId !== projB.id && state.currentProjectId !== projB.id && state.ls !== projB.id) {
      console.error('Project selection did not persist:', state);
      await browser.close();
      process.exit(3);
    }

    // Reload page and ensure lastProject is picked up
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
      const el = document.querySelector('[x-data="app"]');
      if (el && el.__x && el.__x.$data) {
        const d = el.__x.$data;
        return { currentProjectId: d.currentProject ? d.currentProject.id : null, selectedProjectId: d.selectedProjectId || null };
      }
      return { currentProjectId: null, selectedProjectId: null };
    });

    if (after.currentProjectId !== projB.id && after.selectedProjectId !== projB.id) {
      console.error('After reload project not selected:', after);
      await browser.close();
      process.exit(4);
    }

    console.log('ui-projects test passed.');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('ui-projects test failed:', err && err.message ? err.message : err);
    await browser.close();
    process.exit(1);
  }
})();
