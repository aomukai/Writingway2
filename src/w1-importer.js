// Writingway 1 Importer Module
// Imports projects from Writingway 1 file structure into Writingway 2 IndexedDB
(function () {
    const W1Importer = {
        /**
         * Import a Writingway 1 project from a folder
         * @param {Object} app - Alpine app instance
         * @param {FileList} files - Files from directory input
         */
        async importProject(app, files) {
            if (!files || files.length === 0) {
                alert('No files selected. Please select a Writingway 1 project folder.');
                return;
            }

            app.w1ImportInProgress = true;

            try {
                // Parse files into structure
                const fileMap = {};
                for (const file of files) {
                    const path = file.webkitRelativePath || file.name;
                    fileMap[path] = file;
                }

                // Find structure.json file
                const structureFile = Object.keys(fileMap).find(p => p.endsWith('_structure.json'));
                if (!structureFile) {
                    throw new Error('Could not find project structure file (*_structure.json)');
                }

                // Extract project name from structure file name
                const projectName = structureFile.split('/').pop().replace('_structure.json', '');

                // Read structure file
                const structureData = JSON.parse(await this.readFileAsText(fileMap[structureFile]));

                // Read compendium if exists
                const compendiumFile = Object.keys(fileMap).find(p => p.endsWith('/compendium.json'));
                let compendiumData = null;
                if (compendiumFile) {
                    compendiumData = JSON.parse(await this.readFileAsText(fileMap[compendiumFile]));
                }

                // Create new project in DB
                const projectId = Date.now().toString();
                const project = {
                    id: projectId,
                    name: projectName,
                    created: new Date(),
                    modified: new Date()
                };
                await db.projects.add(project);

                // Import structure (flatten acts into chapters)
                let chapterOrder = 0;
                const chapterMap = {}; // Track chapter IDs for scenes

                for (const act of (structureData.acts || [])) {
                    for (const chapter of (act.chapters || [])) {
                        const chapterId = Date.now().toString() + '-c' + chapterOrder;
                        const chapterName = act.name !== 'Act 1'
                            ? `${act.name} - ${chapter.name}`
                            : chapter.name;

                        await db.chapters.add({
                            id: chapterId,
                            projectId: projectId,
                            title: chapterName,
                            order: chapterOrder,
                            created: new Date(),
                            modified: new Date()
                        });

                        chapterMap[`${act.name}-${chapter.name}`] = chapterId;

                        // Import scenes for this chapter
                        let sceneOrder = 0;
                        for (const scene of (chapter.scenes || [])) {
                            await this.importScene(
                                app,
                                fileMap,
                                projectId,
                                projectName,
                                act.name,
                                chapter.name,
                                scene,
                                chapterId,
                                sceneOrder
                            );
                            sceneOrder++;
                        }

                        chapterOrder++;
                    }
                }

                // Import compendium
                if (compendiumData) {
                    await this.importCompendium(app, projectId, compendiumData);
                }

                // Reload projects and select the new one
                await app.loadProjects();
                app.showW1ImportModal = false;
                app.w1ImportInProgress = false;

                alert(`✓ Successfully imported "${projectName}"!\n\n${chapterOrder} chapters imported.`);

                // Open the imported project
                await app.openProject(projectId);

            } catch (e) {
                console.error('Failed to import Writingway 1 project:', e);
                alert(`Failed to import project:\n\n${e.message}\n\nSee console for details.`);
                app.w1ImportInProgress = false;
            }
        },

        /**
         * Import a single scene
         */
        async importScene(app, fileMap, projectId, projectName, actName, chapterName, scene, chapterId, sceneOrder) {
            // Find the latest backup file for this scene
            // Pattern: ProjectName-ActName-ChapterName-SceneName_timestamp.html
            // Remove spaces from act/chapter/scene names to match W1 filename format
            const cleanActName = actName.replace(/\s+/g, '');
            const cleanChapterName = chapterName.replace(/\s+/g, '');
            const cleanSceneName = scene.name.replace(/\s+/g, '');
            const scenePattern = `${projectName}-${cleanActName}-${cleanChapterName}-${cleanSceneName}`;

            console.log('Looking for scene files matching:', scenePattern);

            const sceneFiles = Object.keys(fileMap).filter(p => {
                const filename = p.split('/').pop();
                const matches = filename.startsWith(scenePattern) && (filename.endsWith('.html') || filename.endsWith('.txt'));
                if (matches) console.log('Found matching scene file:', filename);
                return matches;
            });

            console.log('Matched scene files:', sceneFiles);

            // Sort by timestamp (newest first)
            sceneFiles.sort((a, b) => {
                const aTime = a.match(/_(\d+)\.(html|txt)$/)?.[1] || '0';
                const bTime = b.match(/_(\d+)\.(html|txt)$/)?.[1] || '0';
                return bTime.localeCompare(aTime);
            });

            let sceneContent = '';
            if (sceneFiles.length > 0) {
                console.log('Using latest file:', sceneFiles[0]);
                const latestFile = fileMap[sceneFiles[0]];
                const rawContent = await this.readFileAsText(latestFile);

                console.log('Raw content length:', rawContent.length);

                // Convert Qt HTML to clean HTML
                if (sceneFiles[0].endsWith('.html')) {
                    sceneContent = this.convertQtHtmlToClean(rawContent);
                } else {
                    // Plain text - wrap in paragraph
                    sceneContent = `<p>${rawContent.replace(/\n\n/g, '</p><p>')}</p>`;
                }

                console.log('Converted content length:', sceneContent.length);
            } else {
                console.warn('No scene files found for pattern:', scenePattern);
            }

            // Create scene
            const sceneId = Date.now().toString() + '-s' + sceneOrder + '-' + Math.random().toString(36).slice(2, 6);
            await db.scenes.add({
                id: sceneId,
                projectId: projectId,
                chapterId: chapterId,
                title: scene.name,
                order: sceneOrder,
                povCharacter: '',
                pov: scene.pov || '3rd person limited',
                tense: 'past',
                created: new Date(),
                modified: new Date()
            });

            // Create scene content
            await db.content.add({
                sceneId: sceneId,
                text: sceneContent,
                wordCount: this.countWords(sceneContent)
            });
        },

        /**
         * Import compendium entries
         */
        async importCompendium(app, projectId, compendiumData) {
            const categoryMap = {
                'Characters': 'characters',
                'Locations': 'places',
                'Items': 'items',
                'Placeholder': 'notes'
            };

            for (const category of (compendiumData.categories || [])) {
                const w2Category = categoryMap[category.name] || 'notes';

                for (const entry of (category.entries || [])) {
                    const entryId = Date.now().toString() + '-comp-' + Math.random().toString(36).slice(2, 8);
                    await db.compendium.add({
                        id: entryId,
                        projectId: projectId,
                        category: w2Category,
                        title: entry.name,
                        content: entry.content || '',
                        tags: [],
                        image: null,
                        modified: new Date()
                    });
                }
            }
        },

        /**
         * Convert Qt HTML format to clean HTML
         */
        convertQtHtmlToClean(qtHtml) {
            // Strip Qt DOCTYPE and head
            let clean = qtHtml.replace(/<!DOCTYPE[^>]*>/gi, '');
            clean = clean.replace(/<html[^>]*>/gi, '');
            clean = clean.replace(/<\/html>/gi, '');
            clean = clean.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
            clean = clean.replace(/<body[^>]*>/gi, '');
            clean = clean.replace(/<\/body>/gi, '');

            // Remove Qt-specific paragraph attributes but keep the content
            clean = clean.replace(/<p[^>]*style="[^"]*-qt-[^"]*"[^>]*>/gi, '<p>');
            clean = clean.replace(/<p[^>]*-qt-paragraph-type:empty[^>]*>/gi, '<p>');

            // Clean up excessive attributes
            clean = clean.replace(/<p[^>]*margin-top:\s*0px[^>]*>/gi, '<p>');

            // Remove empty paragraphs
            clean = clean.replace(/<p[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, '<p></p>');

            // Clean up multiple empty paragraphs
            clean = clean.replace(/(<p><\/p>\s*){3,}/gi, '<p></p><p></p>');

            // Remove horizontal rules made with underscores (common in W1)
            clean = clean.replace(/<p>_{5,}<\/p>/gi, '');

            return clean.trim();
        },

        /**
         * Read file as text
         */
        readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(e);
                reader.readAsText(file);
            });
        },

        /**
         * Count words in HTML content
         */
        countWords(html) {
            if (!html) return 0;
            const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            return text ? text.split(' ').length : 0;
        }
    };

    // Expose to window
    window.W1Importer = W1Importer;
})();
