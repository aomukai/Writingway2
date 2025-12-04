/**
 * Database Module
 * Handles Dexie initialization, schema definitions, and migrations
 */

// Initialize Dexie Database with a migration path
const db = new Dexie('WritingwayDB');

// Original schema (version 1) - ensures compatibility with existing installs
db.version(1).stores({
    projects: 'id, name, created, modified',
    scenes: 'id, projectId, title, order, created, modified',
    content: 'sceneId, text, wordCount'
});

// New schema (version 2) adds chapters and scene.chapterId. Use upgrade() to migrate orphan scenes.
db.version(2).stores({
    projects: 'id, name, created, modified',
    chapters: 'id, projectId, title, order, created, modified',
    scenes: 'id, projectId, chapterId, title, order, created, modified',
    content: 'sceneId, text, wordCount'
}).upgrade(async tx => {
    try {
        const projects = await tx.table('projects').toArray();
        for (const p of projects) {
            // Create a default chapter for the project
            const chapId = Date.now().toString() + '-m-' + Math.random().toString(36).slice(2, 7);
            await tx.table('chapters').add({
                id: chapId,
                projectId: p.id,
                title: t('chapter.defaultTitle'),
                order: 0,
                created: new Date(),
                modified: new Date()
            });

            // Move orphan scenes (no chapterId) into the new default chapter
            const orphanScenes = await tx.table('scenes').where('projectId').equals(p.id).filter(s => !s.chapterId).toArray();
            for (const s of orphanScenes) {
                await tx.table('scenes').update(s.id, { chapterId: chapId });
            }
        }
    } catch (e) {
        // If migration fails for any reason, log but don't block opening the DB
        console.error('Dexie upgrade migration failed:', e);
    }
});

// Add prompts and codex tables (v3)
db.version(3).stores({
    prompts: 'id, projectId, category, title, created, modified',
    codex: 'id, projectId, title, created, modified'
}).upgrade(async tx => {
    // noop migration for now; existing installs will get empty prompts/codex
});

// Add compendium table (v4)
db.version(4).stores({
    compendium: 'id, projectId, category, title, modified, tags'
}).upgrade(async tx => {
    // noop migration; new installs will get empty compendium
});

// Add compound index for compendium queries to speed up category lookups
// This creates a compound index on [projectId+category] which Dexie will use
// when querying by both fields together (e.g., { projectId, category }).
// Use a new DB version so existing installs get the index via Dexie migration.
db.version(5).stores({
    compendium: 'id, [projectId+category], projectId, category, title, modified, tags'
}).upgrade(async tx => {
    // noop: index addition handled by Dexie
});

// Add prompt history table (v6)
db.version(6).stores({
    projects: 'id, name, created, modified',
    chapters: 'id, projectId, title, order, created, modified',
    scenes: 'id, projectId, chapterId, title, order, created, modified',
    content: 'sceneId, text, wordCount',
    prompts: 'id, projectId, category, title, created, modified',
    codex: 'id, projectId, title, created, modified',
    compendium: 'id, [projectId+category], projectId, category, title, modified, tags',
    promptHistory: 'id, projectId, sceneId, timestamp, beat, prompt'
}).upgrade(async tx => {
    // noop: new table for prompt history
});

// Add workshopSessions table for Workshop Chat feature (v7)
db.version(7).stores({
    projects: 'id, name, created, modified',
    chapters: 'id, projectId, title, order, created, modified',
    scenes: 'id, projectId, chapterId, title, order, created, modified',
    content: 'sceneId, text, wordCount',
    prompts: 'id, projectId, category, title, created, modified',
    codex: 'id, projectId, title, created, modified',
    compendium: 'id, [projectId+category], projectId, category, title, modified, tags',
    promptHistory: 'id, projectId, sceneId, timestamp, beat, prompt',
    workshopSessions: 'id, projectId, name, createdAt, updatedAt'
}).upgrade(async tx => {
    // noop: new table will be created automatically
});

// Add updatedAt timestamps for multi-tab sync (v8)
db.version(8).stores({
    projects: 'id, name, created, modified, updatedAt',
    chapters: 'id, projectId, title, order, created, modified, updatedAt',
    scenes: 'id, projectId, chapterId, title, order, created, modified, updatedAt',
    content: 'sceneId, text, wordCount, updatedAt',
    prompts: 'id, projectId, category, title, created, modified, updatedAt',
    codex: 'id, projectId, title, created, modified, updatedAt',
    compendium: 'id, [projectId+category], projectId, category, title, modified, tags, updatedAt',
    promptHistory: 'id, projectId, sceneId, timestamp, beat, prompt',
    workshopSessions: 'id, projectId, name, createdAt, updatedAt'
}).upgrade(async tx => {
    // Add updatedAt to existing records
    const now = Date.now();

    await tx.table('projects').toCollection().modify(proj => {
        if (!proj.updatedAt) proj.updatedAt = now;
    });

    await tx.table('chapters').toCollection().modify(ch => {
        if (!ch.updatedAt) ch.updatedAt = now;
    });

    await tx.table('scenes').toCollection().modify(sc => {
        if (!sc.updatedAt) sc.updatedAt = now;
    });

    await tx.table('content').toCollection().modify(cont => {
        if (!cont.updatedAt) cont.updatedAt = now;
    });

    await tx.table('prompts').toCollection().modify(pr => {
        if (!pr.updatedAt) pr.updatedAt = now;
    });

    await tx.table('codex').toCollection().modify(cd => {
        if (!cd.updatedAt) cd.updatedAt = now;
    });

    await tx.table('compendium').toCollection().modify(comp => {
        if (!comp.updatedAt) comp.updatedAt = now;
    });
});

// Expose the global Dexie instance for debugging and console usage
try { window.db = window.db || db; } catch (e) { /* ignore in non-browser env */ }

// Note: Dexie will open when first used; no automatic recovery toggles are present.
