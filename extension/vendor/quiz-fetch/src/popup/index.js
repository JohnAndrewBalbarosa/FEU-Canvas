(() => {
    "use strict";
    
    // Message types for communication with content script
    const MESSAGE_TYPES = {
        DEBUG: "quiz-fetch-debug",
        PING: "quiz-fetch-ping",
        PONG: "quiz-fetch-pong",
        GET_HISTORY: "quiz-fetch-get-history",
        GET_STATS: "quiz-fetch-get-stats",
        EXPORT_DATA: "quiz-fetch-export-data",
        IMPORT_DATA: "quiz-fetch-import-data"
    };

    // Helper for async/await in the IIFE
    const asyncHandler = function (thisArg, _arguments, P, generator) {
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) {
                try {
                    step(generator.next(value));
                } catch (e) {
                    reject(e);
                }
            }
            function rejected(value) {
                try {
                    step(generator.throw(value));
                } catch (e) {
                    reject(e);
                }
            }
            function step(result) {
                var value;
                result.done ? resolve(result.value) : (value = result.value, value instanceof P ? value : new P(function (r) {
                    r(value);
                })).then(fulfilled, rejected);
            }
            step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
    };

    // Dropdown menu handling
    const dropdown = document.querySelector(".dropdown");
    dropdown.addEventListener("click", (e) => {
        dropdown.classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove("open");
        }
    });

    // Download debug handler - includes localStorage data
    document.getElementById("download-debug").addEventListener("click", () => asyncHandler(void 0, void 0, void 0, function* () {
        let debugContent = '=== QuizFetch Debug Report ===\n';
        debugContent += `Date: ${new Date().toISOString()}\n`;
        debugContent += `Version: ${browser.runtime.getManifest().version}\n\n`;
        
        // Get localStorage data
        debugContent += '=== LocalStorage Data ===\n';
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('quizfetch_')) {
                const value = localStorage.getItem(key);
                debugContent += `\n--- ${key} ---\n`;
                try {
                    // Pretty print JSON values
                    const parsed = JSON.parse(value);
                    debugContent += JSON.stringify(parsed, null, 2);
                } catch {
                    debugContent += value;
                }
                debugContent += '\n';
            }
        }
        
        // Try to get additional debug from content script
        try {
            const tabs = yield browser.tabs.query({
                active: true,
                currentWindow: true
            });
            const contentDebug = yield browser.tabs.sendMessage(tabs[0].id, {
                type: MESSAGE_TYPES.DEBUG
            });
            if (contentDebug) {
                debugContent += '\n=== Content Script Debug ===\n';
                debugContent += contentDebug;
            }
        } catch (err) {
            debugContent += '\n=== Content Script Debug ===\n';
            debugContent += 'Content script not available on this page.\n';
        }
        
        const blob = new Blob([debugContent], { type: "text/plain" });
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(blob);
        anchor.download = "quizfetch-debug.txt";
        anchor.click();
        URL.revokeObjectURL(anchor.href);
    }));

    // Show toast notification
    function showToast(message, type = 'info') {
        // Remove existing toast if any
        const existingToast = document.querySelector('.toast');
        if (existingToast) existingToast.remove();
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.remove(), 3000);
    }

    // Export data handler - exports all quizfetch_ localStorage data as JSON via content script
    document.getElementById("export-data").addEventListener("click", () => asyncHandler(void 0, void 0, void 0, function* () {
        try {
            const tabs = yield browser.tabs.query({
                active: true,
                currentWindow: true
            });
            
            const exportData = yield browser.tabs.sendMessage(tabs[0].id, {
                type: MESSAGE_TYPES.EXPORT_DATA
            });
            
            if (!exportData || Object.keys(exportData).length === 0) {
                showToast('No data to export. Take some quizzes first!', 'error');
                return;
            }
            
            // Create and download the JSON file
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toISOString().split('T')[0];
            a.download = `quizfetch-backup-${date}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            showToast('Data exported successfully!', 'success');
        } catch (error) {
            console.error('Export error:', error);
            showToast('Export failed. Make sure you are on a Canvas page.', 'error');
        }
    }));

    // Import data handler
    document.getElementById("import-data").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("import-file-input").click();
    });

    // Handle file selection for import
    document.getElementById("import-file-input").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => asyncHandler(void 0, void 0, void 0, function* () {
            try {
                const importData = JSON.parse(event.target.result);
                
                // Validate the data structure
                if (typeof importData !== 'object' || importData === null) {
                    throw new Error('Invalid data format');
                }
                
                const tabs = yield browser.tabs.query({
                    active: true,
                    currentWindow: true
                });
                
                const result = yield browser.tabs.sendMessage(tabs[0].id, {
                    type: MESSAGE_TYPES.IMPORT_DATA,
                    data: importData
                });
                
                if (result && result.success) {
                    showToast(`Imported ${result.count} items successfully!`, 'success');
                    
                    // Refresh the page data
                    setTimeout(() => {
                        checkAndLoadData();
                    }, 500);
                } else {
                    throw new Error('Import failed');
                }
                
            } catch (error) {
                console.error('Import error:', error);
                showToast('Import failed. Make sure you are on a Canvas page and the file is valid.', 'error');
            }
        })();
        
        reader.onerror = () => {
            showToast('Failed to read file', 'error');
        };
        
        reader.readAsText(file);
        
        // Reset the input so the same file can be selected again
        e.target.value = '';
    });

    // Format date for display
    function formatDate(isoString) {
        if (!isoString) return 'Unknown';
        try {
            const date = new Date(isoString);
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) {
                return 'Today';
            } else if (diffDays === 1) {
                return 'Yesterday';
            } else if (diffDays < 7) {
                return diffDays + ' days ago';
            } else {
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }
        } catch (error) {
            return 'Unknown';
        }
    }

    // Render recent quizzes list
    function renderRecentQuizzes(quizzes) {
        const container = document.getElementById('recent-quizzes-list');
        
        if (!quizzes || quizzes.length === 0) {
            container.innerHTML = '<div class="empty-state">No quizzes captured yet. Take a quiz on Canvas to get started!</div>';
            return;
        }

        let html = '';
        quizzes.forEach(quiz => {
            html += `
                <div class="quiz-item">
                    <div class="quiz-item-main">
                        <div class="quiz-title">${quiz.quizTitle || 'Untitled Quiz'}</div>
                        <div class="quiz-course">${quiz.courseName || 'Unknown Course'}</div>
                    </div>
                    <div class="quiz-item-meta">
                        <span class="quiz-questions">${quiz.questionCount} Q${quiz.questionCount !== 1 ? 's' : ''}</span>
                        <span class="quiz-date">${formatDate(quiz.lastUpdatedAt)}</span>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    // Update stats display
    function updateStats(stats) {
        document.getElementById('stat-quizzes').textContent = stats.totalQuizzes || 0;
        document.getElementById('stat-questions').textContent = stats.totalQuestions || 0;
        document.getElementById('stat-courses').textContent = stats.courseCount || 0;
    }

    // Check if on Canvas page and fetch data
    function checkAndLoadData() {
        return asyncHandler(this, void 0, void 0, function* () {
            try {
                const tabs = yield browser.tabs.query({
                    active: true,
                    currentWindow: true
                });

                // Try to ping the content script
                try {
                    const response = yield browser.tabs.sendMessage(tabs[0].id, {
                        type: MESSAGE_TYPES.PING
                    });

                    if (response === MESSAGE_TYPES.PONG) {
                        // Content script is active - show dropdown and fetch stats
                        dropdown.classList.remove("hidden");
                        
                        // Hide status section, show stats and history
                        document.getElementById('status-section').classList.add('hidden');
                        document.getElementById('stats-section').classList.remove('hidden');
                        document.getElementById('history-section').classList.remove('hidden');

                        // Fetch stats
                        const stats = yield browser.tabs.sendMessage(tabs[0].id, {
                            type: MESSAGE_TYPES.GET_STATS
                        });

                        if (stats && !stats.error) {
                            updateStats(stats);
                            renderRecentQuizzes(stats.recentQuizzes);
                        }
                        
                        return true;
                    }
                } catch (err) {
                    // Content script not available
                }

                // Not on Canvas - show status section, hide stats
                document.getElementById('status-section').classList.remove('hidden');
                document.getElementById('stats-section').classList.add('hidden');
                document.getElementById('history-section').classList.add('hidden');
                
                return false;
            } catch (error) {
                console.error('Error checking page:', error);
                return false;
            }
        });
    }

    // Initialize
    checkAndLoadData();
    
    // Load version from manifest
    const manifestData = browser.runtime.getManifest();
    const versionElement = document.getElementById('version');
    if (versionElement && manifestData.version) {
        versionElement.textContent = 'v' + manifestData.version;
    }
})();