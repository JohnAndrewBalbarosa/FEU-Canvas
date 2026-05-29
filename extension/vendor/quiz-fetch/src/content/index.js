(function () {
    'use strict';

    // ============== MODULE REFERENCES ==============
    // These modules are loaded before index.js via manifest.json
    const LUCIDE_ICONS = window.QUIZFETCH_ICONS;
    const APPLICATION_CONFIG = window.QUIZFETCH_CONFIG;
    const THEMES = window.QUIZFETCH_THEMES;
    const safeLocalStorageSet = window.safeLocalStorageSet;
    const safeLocalStorageGet = window.safeLocalStorageGet;

    // Theme: QuizFetch overlay is light-only.
    let currentTheme = THEMES.light;

    // Check if script is already loaded to prevent duplicates
    if (window.canvasQuizFetcherInitialized) {
        return;
    }

    // Mark as initialized
    window.canvasQuizFetcherInitialized = true;

    // One-time cleanup: theme preference no longer exists.
    try {
        if (window.quizfetchStorage && typeof window.quizfetchStorage.remove === 'function') {
            window.quizfetchStorage.remove('quizfetch_theme');
        } else {
            localStorage.removeItem('quizfetch_theme');
        }
    } catch (e) {
        // Ignore localStorage errors (private mode / disabled storage).
    }

    // ============== DEBUG LOG BUFFER ==============
    const MAX_DEBUG_LOGS = 500;
    const debugLogBuffer = [];

    function addDebugLog(level, ...args) {
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        debugLogBuffer.push({
            timestamp: new Date().toISOString(),
            level: level,
            message: message
        });

        if (debugLogBuffer.length > MAX_DEBUG_LOGS) {
            debugLogBuffer.shift();
        }
    }

    const originalConsoleLog = console.log.bind(console);
    const originalConsoleError = console.error.bind(console);
    const originalConsoleWarn = console.warn.bind(console);
    const originalConsoleDebug = console.debug.bind(console);

    console.log = function(...args) { addDebugLog('log', ...args); originalConsoleLog(...args); };
    console.error = function(...args) { addDebugLog('error', ...args); originalConsoleError(...args); };
    console.warn = function(...args) { addDebugLog('warn', ...args); originalConsoleWarn(...args); };
    console.debug = function(...args) { addDebugLog('debug', ...args); originalConsoleDebug(...args); };

    // Error handling wrapper for fetch operations
    function safeFetch(url, options) {
        return fetch(url, options)
            .catch(error => {
                console.error('Network error during fetch:', error);
                return null;
            });
    }

    // Strip Canvas results-page injections from a cloned answer element
    function cleanAnswerElement(el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll(
            '#incorrect_answers, #correct_text_answer, ' +
            '[data-choice-id="incorrect_answer"], [data-choice-id="correct_text_answer"], ' +
            '.answer_correctness, .answer_feedback, ' +
            '.correct_answer_feedback, .wrong_answer_feedback, ' +
            'span.hidden.id, span.id.hidden, .answer_id_holder, .hidden_id'
        ).forEach(n => n.remove());
        return clone;
    }

    // Function to safely sanitize HTML content while allowing certain safe tags
    function sanitizeHtmlForDisplay(htmlString) {
        if (!htmlString) return 'No question text';

        // Convert to string and create a temporary div to work with
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = String(htmlString);

        // Define allowed tags and their allowed attributes
        const allowedTags = {
            'img': ['src', 'alt', 'title', 'width', 'height'],
            'a': ['href', 'title', 'target'],
            'b': [],
            'i': [],
            'em': [],
            'strong': [],
            'u': [],
            'br': [],
            'p': [],
            'div': [],
            'span': ['style'],
            'h1': [], 'h2': [], 'h3': [], 'h4': [], 'h5': [], 'h6': [],
            'ul': [], 'ol': [], 'li': [],
            'blockquote': [],
            'sup': [], 'sub': [],
            'code': [],
            'pre': [],
            'abbr': ['title'],
            'mark': [],
            'kbd': [],
            'cite': [],
            'q': ['cite'],
            'var': [],
            'samp': [],
            'del': [],
            'ins': [],
            's': [],
            'dfn': ['title'],
            'small': [],
            'time': ['datetime'],
            'table': [],
            'thead': [],
            'tbody': [],
            'tfoot': [],
            'tr': [],
            'th': ['colspan', 'rowspan'],
            'td': ['colspan', 'rowspan'],
            'caption': [],
            'figure': [],
            'figcaption': [],
            'hr': []
        };

        // Function to recursively clean elements
        function cleanElement(element) {
            const tagName = element.tagName.toLowerCase();

            // If tag is not allowed, replace with its text content
            if (!allowedTags.hasOwnProperty(tagName)) {
                const textNode = document.createTextNode(element.textContent || '');
                element.parentNode.replaceChild(textNode, element);
                return;
            }

            // Clean attributes - only keep allowed ones
            const allowedAttrs = allowedTags[tagName];
            const attrs = Array.from(element.attributes);
            attrs.forEach(attr => {
                if (!allowedAttrs.includes(attr.name.toLowerCase())) {
                    element.removeAttribute(attr.name);
                }
            });

            // Special handling for images
            if (tagName === 'img') {
                element.style.maxWidth = '100%';
                element.style.height = 'auto';
                element.style.borderRadius = '4px';
                element.style.marginTop = '5px';
                element.style.marginBottom = '5px';

                if (element.src && !element.src.startsWith('http') && !element.src.startsWith('data:')) {
                    if (element.src.startsWith('/')) {
                        element.src = window.location.origin + element.src;
                    } else {
                        const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
                        element.src = baseUrl + element.src;
                    }
                }
            }

            // Special handling for links
            if (tagName === 'a') {
                element.target = '_blank';
                element.rel = 'noopener noreferrer';
                element.style.color = '#2563eb';
                element.style.textDecoration = 'underline';
                element.style.textUnderlineOffset = '2px';
                element.style.cursor = 'pointer';
                element.style.wordBreak = 'break-word';
                
                if (element.href && !element.href.startsWith('http') && !element.href.startsWith('mailto:') && !element.href.startsWith('tel:')) {
                    if (element.getAttribute('href').startsWith('/')) {
                        element.href = window.location.origin + element.getAttribute('href');
                    } else if (!element.getAttribute('href').startsWith('#')) {
                        const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
                        element.href = baseUrl + element.getAttribute('href');
                    }
                }
            }

            // Special handling for code elements
            if (tagName === 'code') {
                element.style.backgroundColor = '#f1f1f1';
                element.style.color = '#e53e3e';
                element.style.padding = '0.125rem 0.25rem';
                element.style.borderRadius = '0.25rem';
                element.style.fontSize = '0.875em';
                element.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
            }

            // Special handling for pre elements
            if (tagName === 'pre') {
                element.style.backgroundColor = '#f7fafc';
                element.style.border = '1px solid #e2e8f0';
                element.style.borderRadius = '0.375rem';
                element.style.padding = '0.75rem';
                element.style.marginTop = '0.5rem';
                element.style.marginBottom = '0.5rem';
                element.style.fontSize = '0.875em';
                element.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
                element.style.overflowX = 'auto';
                element.style.whiteSpace = 'pre-wrap';
            }

            // Special handling for kbd
            if (tagName === 'kbd') {
                element.style.backgroundColor = '#f1f1f1';
                element.style.border = '1px solid #d1d5db';
                element.style.borderRadius = '0.25rem';
                element.style.padding = '0.125rem 0.375rem';
                element.style.fontSize = '0.875em';
                element.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
                element.style.boxShadow = '0 1px 0 #d1d5db';
            }

            // Special handling for mark
            if (tagName === 'mark') {
                element.style.backgroundColor = '#fef08a';
                element.style.padding = '0.125rem 0.25rem';
                element.style.borderRadius = '0.125rem';
            }

            // Special handling for samp
            if (tagName === 'samp') {
                element.style.backgroundColor = '#f1f1f1';
                element.style.color = '#374151';
                element.style.padding = '0.125rem 0.25rem';
                element.style.borderRadius = '0.25rem';
                element.style.fontSize = '0.875em';
                element.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
            }

            // Special handling for var
            if (tagName === 'var') {
                element.style.fontStyle = 'italic';
                element.style.color = '#7c3aed';
            }

            // Special handling for abbr
            if (tagName === 'abbr') {
                element.style.textDecoration = 'underline dotted';
                element.style.cursor = 'help';
            }

            // Special handling for cite
            if (tagName === 'cite') {
                element.style.fontStyle = 'italic';
                element.style.color = '#6b7280';
            }

            // Special handling for q
            if (tagName === 'q') {
                element.style.fontStyle = 'italic';
            }

            // Special handling for blockquote
            if (tagName === 'blockquote') {
                element.style.borderLeft = '4px solid #e5e7eb';
                element.style.paddingLeft = '1rem';
                element.style.marginLeft = '0';
                element.style.marginTop = '0.5rem';
                element.style.marginBottom = '0.5rem';
                element.style.color = '#6b7280';
                element.style.fontStyle = 'italic';
            }

            // Special handling for del/s
            if (tagName === 'del' || tagName === 's') {
                element.style.textDecoration = 'line-through';
                element.style.color = '#9ca3af';
            }

            // Special handling for ins
            if (tagName === 'ins') {
                element.style.textDecoration = 'underline';
                element.style.color = '#059669';
            }

            // Special handling for table
            if (tagName === 'table') {
                element.style.borderCollapse = 'collapse';
                element.style.width = '100%';
                element.style.marginTop = '0.5rem';
                element.style.marginBottom = '0.5rem';
                element.style.fontSize = '0.875em';
            }

            if (tagName === 'th' || tagName === 'td') {
                element.style.border = '1px solid #e5e7eb';
                element.style.padding = '0.5rem';
                element.style.textAlign = 'left';
            }

            if (tagName === 'th') {
                element.style.backgroundColor = '#f9fafb';
                element.style.fontWeight = '600';
            }

            // Special handling for figure
            if (tagName === 'figure') {
                element.style.margin = '0.5rem 0';
                element.style.textAlign = 'center';
            }

            if (tagName === 'figcaption') {
                element.style.fontSize = '0.875em';
                element.style.color = '#6b7280';
                element.style.marginTop = '0.25rem';
            }

            // Special handling for hr
            if (tagName === 'hr') {
                element.style.border = 'none';
                element.style.borderTop = '1px solid #e5e7eb';
                element.style.margin = '1rem 0';
            }

            // Recursively clean child elements
            const children = Array.from(element.children);
            children.forEach(child => cleanElement(child));
        }

        // Clean all elements in the temp div
        const elements = Array.from(tempDiv.querySelectorAll('*'));
        elements.forEach(element => cleanElement(element));

        return tempDiv.innerHTML;
    }

    // Extract quiz title from Canvas page DOM or ENV
    function extractQuizTitle() {
        try {
            // Try various selectors for quiz title
            const selectors = [
                '.quiz-title',
                '#quiz_title',
                '.quiz-header .title',
                'h1.page-title',
                '.page-title',
                '#content h1',
                '.quiz-header h1'
            ];
            
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent.trim()) {
                    return element.textContent.trim();
                }
            }
            
            // Try Canvas ENV global if available
            if (typeof ENV !== 'undefined' && ENV.QUIZ && ENV.QUIZ.title) {
                return ENV.QUIZ.title;
            }
            
            // Try to get from page title
            const pageTitle = document.title;
            if (pageTitle && !pageTitle.includes('Canvas')) {
                // Remove common suffixes like " - Course Name"
                const parts = pageTitle.split(' - ');
                if (parts.length > 0 && parts[0].trim()) {
                    return parts[0].trim();
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error extracting quiz title:', error);
            return null;
        }
    }

    // Extract course name from Canvas page DOM, breadcrumbs, or ENV
    function extractCourseName() {
        try {
            // Try Canvas ENV global first (most reliable)
            if (typeof ENV !== 'undefined') {
                if (ENV.COURSE && ENV.COURSE.name) {
                    return ENV.COURSE.name;
                }
                if (ENV.course && ENV.course.name) {
                    return ENV.course.name;
                }
            }
            
            // Try breadcrumb navigation
            const breadcrumbSelectors = [
                '#breadcrumbs li:nth-child(2) a',
                '.ic-app-crumbs li:nth-child(2) a',
                'nav[aria-label="breadcrumbs"] li:nth-child(2) a',
                '.breadcrumb li:nth-child(2) a'
            ];
            
            for (const selector of breadcrumbSelectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent.trim()) {
                    return element.textContent.trim();
                }
            }
            
            // Try course header
            const courseHeaderSelectors = [
                '.course-title',
                '#section-tabs-header',
                '.context_header h1',
                '.course-header h1'
            ];
            
            for (const selector of courseHeaderSelectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent.trim()) {
                    return element.textContent.trim();
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error extracting course name:', error);
            return null;
        }
    }

    // Initialize the Quiz Fetcher functionality
    function initQuizFetcher() {
        try {

            // Display onboarding for new users
            displayUserOnboarding();

            // Run one-time migration for existing questions
            migrateExistingQuestions();

            // Run one-time migration for history metadata
            migrateHistoryMetadata();

            // Record extension initialization and update question count
            recordUserInteraction('extension_initialized');
            updateTotalQuestionsCount();

            // Set up periodic question count updates (every 30 seconds)
            setInterval(updateTotalQuestionsCount, 30000);

            // Add a style tag to prevent button duplication through CSS
            const styleTag = document.createElement('style');
            styleTag.id = 'quiz-loader-styles';
            styleTag.textContent = `
                /* Hide multiple buttons by only showing the first one */
                .quiz-header .view-collected-questions:not(:first-of-type),
                .ig-header .view-collected-questions:not(:first-of-type),
                button.view-collected-questions:not(:first-of-type) {
                    display: none !important;
                }
                
                /* Make sure we only have one per container */
                .quiz-loader-button-container:not(:first-of-type) {
                    display: none !important;
                }
                
                /* Hide all view-collected-questions buttons on submission pages */
                .quiz-submission button.view-collected-questions,
                body.context_submissions button.view-collected-questions,
                body.context_submissions .quiz-loader-button-container {
                    display: none !important;
                }

                /* Liquid glass trigger button */
                .view-collected-questions {
                    appearance: none;
                    -webkit-appearance: none;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    padding: 0.5rem 0.75rem;
                    border-radius: 0.5rem;
                    border: 1px solid rgba(255, 255, 255, 0.56);
                    background: rgba(255, 255, 255, 0.42);
                    color: rgba(15, 23, 42, 0.78);
                    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.75), inset 0 -1px 0 rgba(0, 0, 0, 0.03);
                    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    font-size: 0.8125rem;
                    font-weight: 500;
                    letter-spacing: -0.01em;
                    cursor: pointer;
                    -webkit-backdrop-filter: blur(10px) saturate(1.4);
                    backdrop-filter: blur(10px) saturate(1.4);
                    transition: background 160ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1);
                }

                .view-collected-questions:hover {
                    background: rgba(255, 255, 255, 0.60);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.82), inset 0 -1px 0 rgba(0, 0, 0, 0.04);
                    transform: translateY(-1px);
                }

                .view-collected-questions:active {
                    transform: translateY(0);
                    background: rgba(255, 255, 255, 0.46);
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.62), inset 0 1px 3px rgba(0, 0, 0, 0.07);
                }

                @media (prefers-reduced-motion: reduce) {
                    .view-collected-questions {
                        transition: none;
                    }
                }
            `;
            document.head.appendChild(styleTag);

            // Check if we're on a quiz page, quiz listing page, or quiz submission page
            const isQuizTakingPage = document.getElementById('questions') !== null;
            const isQuizListingPage = window.location.href.includes('/quizzes') && !window.location.href.includes('/take') && !window.location.href.includes('/submissions/') && !window.location.href.includes('/submissions?');
            
            // Detect "all questions on one page" quiz format (form with submit_quiz_form id and all_questions class)
            const isAllQuestionsQuizPage = document.getElementById('submit_quiz_form') !== null && 
                document.querySelector('form.all_questions') !== null;
            
            // Submission results page has /submissions/ followed by a submission ID, NOT /submissions? with query params
            // The /submissions?user_id= pattern is a quiz-taking page, not a results page
            const isQuizSubmissionPage = (window.location.href.includes('/submissions/') && 
                !window.location.href.match(/\/submissions\?/)) || 
                (document.querySelector('.quiz-submission') !== null && !isAllQuestionsQuizPage);

            // If on submission page, remove any existing buttons
            if (isQuizSubmissionPage) {
                // Remove container elements
                document.querySelectorAll('.quiz-loader-button-container').forEach(container => {
                    container.remove();
                });

                // Remove any existing View Collected Questions buttons
                document.querySelectorAll('.view-collected-questions').forEach(button => {
                    button.remove();
                });

                // Also try removing by text content
                document.querySelectorAll('button').forEach(button => {
                    if (button.textContent.includes('View Collected')) {
                        button.remove();
                    }
                });
            }

            // Set up different handlers based on page type
            if (isQuizTakingPage || isAllQuestionsQuizPage) {
                // Watch for changes to the question container
                setupQuestionObserver();

                // Watch for clicks on navigation buttons in quiz-taking view
                setupNavigationListener();

                // Initial data collection for current question(s)
                // For "all questions" pages, this will capture all questions at once
                setTimeout(fetchQuestionData, 1000);
                
                // For all-questions pages, also try capturing after a longer delay
                // in case the page takes longer to fully render
                if (isAllQuestionsQuizPage) {
                    setTimeout(fetchQuestionData, 3000);
                }
            } else if (isQuizListingPage) {
                // Add view buttons to quiz headers on listing page
                setupQuizListingButtons();
            }
            // Removed the submission page button setup - no buttons will be added to submission pages
        } catch (error) {
            console.error("Error during initialization:", error);
        }
    }

    function setupQuestionObserver() {
        try {
            const quizContainer = document.getElementById('questions');

            if (quizContainer) {
                const observer = new MutationObserver(function (mutations) {
                    try {
                        mutations.forEach(function (mutation) {
                            if (mutation.type === 'childList' || mutation.type === 'attributes') {
                                // When content changes, fetch the current question data
                                setTimeout(fetchQuestionData, 500);
                            }
                        });
                    } catch (error) {
                        console.error("Error in mutation observer:", error);
                    }
                });

                observer.observe(quizContainer, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['class', 'style']
                });

            } else {
                // Retry after a delay in case the container isn't loaded yet
                setTimeout(setupQuestionObserver, 2000);
            }
        } catch (error) {
            console.error("Error setting up mutation observer:", error);
        }
    }

    // Utility: Always get quizId and assignmentId from the current URL (from index.js logic)
    function getCurrentQuizAndAssignmentIdFromUrl() {
        const link = window.location.href;
        let quizId = null, assignmentId = null;
        if (link.includes("quizzes/")) {
            quizId = parseInt(link.split("quizzes/")[1].split("/")[0]);
        }
        if (link.includes("assignments/")) {
            assignmentId = parseInt(link.split("assignments/")[1].split("/")[0]);
        }
        if (!assignmentId) {
            const assignmentIdMeta = document.querySelector('meta[name="assignment_id"]');
            if (assignmentIdMeta) {
                assignmentId = parseInt(assignmentIdMeta.content);
            }
        }
        if (!assignmentId) {
            const assignmentIdElement = document.querySelector('[data-assignment-id]');
            if (assignmentIdElement) {
                assignmentId = parseInt(assignmentIdElement.getAttribute('data-assignment-id'));
            }
        }
        return { quizId, assignmentId };
    }

    // Update showPopup to use the utility
    function showPopup(quizData, currentCourseId, submissionHistory) {
        try {

            // Always use the quizId and assignmentId from the current URL
            const { quizId: currentQuizId, assignmentId: currentAssignmentId } = getCurrentQuizAndAssignmentIdFromUrl();

            // If we have courseId and quizId, always try to fetch the latest submission data
            if (currentCourseId && currentQuizId) {
                const baseUrl = window.location.origin + '/';
                getQuizSubmissions(currentCourseId, currentQuizId, baseUrl, currentAssignmentId)
                    .then(freshSubmissionData => {
                        // Render popup with the freshest submission data
                        renderPopupWithData(quizData, currentCourseId, freshSubmissionData);
                    })
                    .catch(error => {
                        console.error("Error fetching submission history (showPopup):", error);
                        // Fall back to showing popup with whatever submissionHistory was passed in
                        renderPopupWithData(quizData, currentCourseId, submissionHistory);
                    });
                return; // Don't continue with the rest of the function, rendering will be handled in the promise
            }

            // If we can't fetch, just render with what we have
            renderPopupWithData(quizData, currentCourseId, submissionHistory);
        } catch (error) {
            console.error("? Error showing popup:", error);
            alert("Error showing popup: " + error.message);
        }
    }

    // Update setupNavigationListener to use the utility
    function setupNavigationListener() {
        try {
            document.addEventListener('click', function (e) {
                try {
                    // Handle navigation buttons and quiz header clicks in quiz-taking view
                    if (e.target.closest('.quiz-header')) {

                        // Fetch data first to ensure we have the latest
                        fetchQuestionData();

                        // Get the stored quiz data
                        const quizData = retrieveData();

                        // Get current course ID from URL
                        const link = window.location.href;
                        let currentCourseId = null;
                        try {
                            currentCourseId = parseInt(link.split("courses/")[1].split("/")[0]);
                        } catch (error) {
                            currentCourseId = null;
                        }
                        // Always use the quizId and assignmentId from the current URL
                        const { quizId: currentQuizId, assignmentId: currentAssignmentId } = getCurrentQuizAndAssignmentIdFromUrl();

                        // Fetch submission data from Canvas API if we have the necessary IDs
                        if (currentCourseId && currentQuizId) {
                            const baseUrl = window.location.origin + '/';
                            getQuizSubmissions(currentCourseId, currentQuizId, baseUrl, currentAssignmentId)
                                .then(submissionData => {
                                    showPopup(quizData, currentCourseId, submissionData);
                                })
                                .catch(error => {
                                    console.error("Error fetching submission history:", error);
                                    // Fall back to showing popup without submission data
                                    showPopup(quizData, currentCourseId, null);
                                });
                        } else {
                            // Show popup with locally stored data if we can't fetch from API
                            showPopup(quizData, currentCourseId, null);
                        }
                    }
                } catch (error) {
                    console.error("Error handling navigation click:", error);
                }
            });

        } catch (error) {
            console.error("Error setting up navigation listener:", error);
        }
    }

    // Helper: try to find assignmentId from locally stored quiz data
    function findAssignmentIdFromStoredData(courseId, quizId) {
        try {
            const storedData = safeLocalStorageGet('quizQuestions');
            if (!storedData) return null;
            const questionsData = JSON.parse(storedData);
            if (!questionsData[courseId]) return null;

            for (const [key, entry] of Object.entries(questionsData[courseId])) {
                // Skip non-quiz entries (courseName, etc.)
                if (!entry || typeof entry !== 'object') continue;
                // Match by quizId — key format is either "quizId" or "quizId_assignmentId"
                const keyNum = parseInt(key.split('_')[0]);
                if (keyNum == quizId && entry.assignmentId && entry.assignmentId !== 'unknown') {
                    return parseInt(entry.assignmentId);
                }
                // Also check entry.quizId directly
                if (entry.quizId && parseInt(entry.quizId) == quizId &&
                    entry.assignmentId && entry.assignmentId !== 'unknown') {
                    return parseInt(entry.assignmentId);
                }
            }
        } catch (e) {
            // Ignore storage errors
        }
        return null;
    }

    // Helper: try to find assignmentId by querying the Canvas assignments API and matching quiz_id
    async function findAssignmentIdFromAssignments(courseId, quizId, baseUrl) {
        try {
            const assignmentsUrl = `${baseUrl}api/v1/courses/${courseId}/assignments?per_page=100`;
            const response = await safeFetch(assignmentsUrl);
            if (!response || !response.ok) return null;
            const assignments = await response.json();
            if (!Array.isArray(assignments)) return null;

            const match = assignments.find(a => a.quiz_id && parseInt(a.quiz_id) === parseInt(quizId));
            return match ? match.id : null;
        } catch (e) {
            return null;
        }
    }

    // Function to fetch quiz submissions and submission history using the provided approach
    async function getQuizSubmissions(courseId, quizId, baseUrl, assignmentId) {
        try {
            // If we already have an assignment ID, we can go directly to submission history
            if (assignmentId) {
                const submissionsHistoryUrl = `${baseUrl}api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?include[]=submission_history`;
                const response = await safeFetch(submissionsHistoryUrl);

                if (!response || !response.ok) {
                    throw new Error('Failed to fetch submission history with provided assignment ID');
                }

                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    // Find the current user's submission
                    const userId = await getCurrentUserId(baseUrl);
                    const userSubmission = data.find(submission => submission.user_id === userId);
                    if (userSubmission && userSubmission.submission_history) {
                        return userSubmission.submission_history;
                    }
                }

                // If we couldn't get submission history directly, fall back to the quiz submissions approach
            }

            const quizUrl = `${baseUrl}api/v1/courses/${courseId}/quizzes/${quizId}/`;
            const submissionsURL = quizUrl + 'submissions';

            const [resQuiz, resSubmissions] = await Promise.all([
                safeFetch(quizUrl),
                safeFetch(submissionsURL)
            ]);

            if (!resQuiz || !resQuiz.ok || !resSubmissions || !resSubmissions.ok) {
                throw new Error('Failed to fetch quiz or submissions data');
            }

            const [rawQuiz, rawSubmissions] = await Promise.all([
                resQuiz.json(),
                resSubmissions.json()
            ]);

            const quiz = rawQuiz;
            const submissions = rawSubmissions.quiz_submissions;

            if (!submissions || submissions.length === 0) {
                throw new Error('No submissions found');
            }

            // If we don't already have assignment ID, try a series of fallbacks
            if (!assignmentId) {
                assignmentId = quiz.assignment_id;
            }
            if (!assignmentId) {
                assignmentId = findAssignmentIdFromStoredData(courseId, quizId);
            }
            if (!assignmentId) {
                assignmentId = await findAssignmentIdFromAssignments(courseId, quizId, baseUrl);
            }

            if (!assignmentId) {
                console.warn("getQuizSubmissions: No assignmentId found for quiz", quizId, "— submission history unavailable");
                return null;
            }

            const userId = submissions[submissions.length - 1].user_id;
            if (!userId) {
                throw new Error('Unable to retrieve userId');
            }

            const submissionsHistoryUrl = `${baseUrl}api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}?include[]=submission_history`;
            const response = await safeFetch(submissionsHistoryUrl);

            if (!response || !response.ok) {
                throw new Error('Failed to fetch submission history');
            }

            const data = await response.json();
            return data.submission_history;
        } catch (error) {
            console.error("Error in getQuizSubmissions:", error);
            throw error;
        }
    }

    // Helper function to get current user ID
    async function getCurrentUserId(baseUrl) {
        try {
            const profileUrl = `${baseUrl}api/v1/users/self`;
            const response = await safeFetch(profileUrl);

            if (!response || !response.ok) {
                throw new Error('Failed to fetch user profile');
            }

            const profile = await response.json();
            return profile.id;
        } catch (error) {
            console.error("Error getting current user ID:", error);
            return null;
        }
    }

    // Helper to render the popup UI (factored out for async API fetch)
    function renderPopupWithData(quizData, currentCourseId, submissionHistory) {
        try {
            // Initialize theme if not set
            if (!currentTheme) {
                currentTheme = THEMES.light;
            }

            // Check if a popup already exists and remove it first
            const existingPopup = document.querySelector('.canvas-quiz-loader-popup');
            const existingBackdrop = document.querySelector('.canvas-quiz-loader-backdrop');
            if (existingPopup) {
                document.body.removeChild(existingPopup);
            }
            if (existingBackdrop) {
                document.body.removeChild(existingBackdrop);
            }

            // Create backdrop (transparent, for click-to-close functionality)
            var backdrop = document.createElement("div");
            backdrop.className = 'canvas-quiz-loader-backdrop';
            backdrop.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                /* Liquid glass vignette: dark indigo edges for depth, clear center */
                background: radial-gradient(
                    1400px 900px at 50% 38%,
                    rgba(0, 0, 0, 0.08) 0%,
                    rgba(0, 0, 0, 0.18) 52%,
                    rgba(8, 4, 24, 0.28) 100%
                );
                z-index: 999998;
                opacity: 1;
                visibility: visible;
            `;

            // Create the popup with shadcn/ui styling
            var popup = document.createElement("div");
            popup.className = 'canvas-quiz-loader-popup';
            popup.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: ${currentTheme.popup.background};
                backdrop-filter: ${currentTheme.popup.backdropFilter};
                -webkit-backdrop-filter: ${currentTheme.popup.backdropFilter};
                border: 1px solid ${currentTheme.popup.border};
                border-radius: 0.75rem;
                box-shadow: ${currentTheme.popup.shadow};
                z-index: 999999;
                max-width: 90vw;
                max-height: 90vh;
                width: 56rem;
                min-width: 40rem;
                display: flex;
                flex-direction: column;
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
                opacity: 1;
                visibility: visible;
                overflow: hidden;
                user-select: none;
                will-change: transform, width, height, left, top;
            `;

            // Add custom scrollbar styles - hidden but scrollable
            const scrollbarStyles = document.createElement('style');
            scrollbarStyles.textContent = `
                .canvas-quiz-loader-popup .quiz-content-area::-webkit-scrollbar,
                .canvas-quiz-loader-popup .quiz-history-area::-webkit-scrollbar {
                    width: 0px;
                    display: none;
                }
                .canvas-quiz-loader-popup .quiz-content-area,
                .canvas-quiz-loader-popup .quiz-history-area {
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                }

                /* Icon normalization: SVGs are 1em and inherit currentColor */
                .canvas-quiz-loader-popup svg {
                    width: 1em;
                    height: 1em;
                    display: block;
                }

                /* Frosted lens refinement (cheap): subtle sheen + clear layering */
                .canvas-quiz-loader-popup {
                    position: relative;
                    isolation: isolate;
                    background-clip: padding-box;
                }

                .canvas-quiz-loader-popup::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    pointer-events: none;
                    z-index: 0;
                    /* Directional specular (light at ~310°) + warm caustic at bottom-right */
                    background:
                        radial-gradient(
                            ellipse 58% 32% at 20% -4%,
                            rgba(255, 255, 255, 0.92) 0%,
                            rgba(255, 255, 255, 0.42) 30%,
                            rgba(255, 255, 255, 0) 60%
                        ),
                        radial-gradient(
                            ellipse 44% 28% at 84% 106%,
                            rgba(255, 244, 210, 0.34) 0%,
                            rgba(255, 244, 210, 0) 58%
                        );
                    opacity: 0.80;
                }

                /* Chromatic rim: cool blue fringe at top, warm amber at bottom — real glass splits light */
                .canvas-quiz-loader-popup::after {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    pointer-events: none;
                    z-index: 0;
                    background:
                        linear-gradient(
                            172deg,
                            rgba(200, 218, 255, 0.22) 0%,
                            rgba(255, 255, 255, 0.04) 20%,
                            rgba(255, 255, 255, 0.02) 80%,
                            rgba(255, 230, 172, 0.16) 100%
                        );
                    opacity: 1;
                    box-shadow:
                        inset 0 0 0 0.5px rgba(255, 255, 255, 0.72),
                        inset 0 1px 0 rgba(255, 255, 255, 0.90),
                        inset 0 -1px 0 rgba(0, 0, 0, 0.04),
                        inset 1px 0 0 rgba(255, 255, 255, 0.40),
                        inset -1px 0 0 rgba(255, 255, 255, 0.30);
                }

                /* Keep real content above the sheen layer. */
                .canvas-quiz-loader-popup #quizfetch-drag-handle,
                .canvas-quiz-loader-popup .quiz-content-area,
                .canvas-quiz-loader-popup .quiz-history-area {
                    position: relative;
                    z-index: 1;
                }

                /* Close button: glass tap target with spring scale */
                .canvas-quiz-loader-popup .quizfetch-close-btn {
                    transition: background 140ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 160ms cubic-bezier(0.4, 0, 0.2, 1), transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                .canvas-quiz-loader-popup .quizfetch-close-btn:hover {
                    background: rgba(255, 255, 255, 0.60) !important;
                    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.65), 0 1px 3px rgba(0, 0, 0, 0.06);
                    transform: scale(1.08);
                }
                .canvas-quiz-loader-popup .quizfetch-close-btn:active {
                    background: rgba(255, 255, 255, 0.44) !important;
                    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.42), inset 0 1px 3px rgba(0, 0, 0, 0.10);
                    transform: scale(0.94);
                }

                /* Backdrop-filter fallback: keep the panel readable if unsupported. */
                @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
                    .canvas-quiz-loader-popup {
                        background: rgba(255, 253, 252, 0.94) !important;
                        border-color: rgba(0, 0, 0, 0.08) !important;
                    }
                    .canvas-quiz-loader-popup::before {
                        opacity: 0.22;
                    }
                    .canvas-quiz-loader-popup::after {
                        opacity: 0.15;
                    }
                }
            `;
            popup.appendChild(scrollbarStyles);

            // Noise grain overlay — fractalNoise at 3% opacity gives glass surface texture
            const noiseDiv = document.createElement('div');
            noiseDiv.setAttribute('aria-hidden', 'true');
            noiseDiv.style.cssText = 'position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:0;opacity:0.03;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'200\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.80\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'200\' height=\'200\' filter=\'url(%23n)\' opacity=\'1\'/%3E%3C/svg%3E");background-repeat:repeat;background-size:200px;';
            popup.appendChild(noiseDiv);

            // ----- RESIZE HANDLES (all edges & corners) -----
            const resizeHandles = [];
            function createHandle(dir, cursor, w, h, top, left, right, bottom) {
                const hnd = document.createElement('div');
                hnd.dataset.dir = dir;
                hnd.style.position = 'absolute';
                hnd.style.width = w;
                hnd.style.height = h;
                if (top !== null) hnd.style.top = top;
                if (left !== null) hnd.style.left = left;
                if (right !== null) hnd.style.right = right;
                if (bottom !== null) hnd.style.bottom = bottom;
                hnd.style.cursor = cursor;
                hnd.style.zIndex = '1000000';
                hnd.style.background = 'transparent';
                // Add tooltip to indicate shift+drag functionality
                hnd.title = "Drag to resize";
                popup.appendChild(hnd);
                resizeHandles.push(hnd);
            }

            // Corners (positioned exactly at the corners)
            createHandle('nw', 'nwse-resize', '20px', '20px', '-10px', '-10px', null, null);
            createHandle('ne', 'nesw-resize', '20px', '20px', '-10px', null, '-10px', null);
            createHandle('sw', 'nesw-resize', '20px', '20px', null, '-10px', null, '-10px');
            createHandle('se', 'nwse-resize', '20px', '20px', null, null, '-10px', '-10px');
            // Edges (slightly thicker bars)
            createHandle('n', 'ns-resize', 'calc(100% - 40px)', '16px', '-8px', '20px', null, null);
            createHandle('s', 'ns-resize', 'calc(100% - 40px)', '16px', null, '20px', null, '-8px');
            createHandle('w', 'ew-resize', '16px', 'calc(100% - 40px)', '20px', '-8px', null, null);
            createHandle('e', 'ew-resize', '16px', 'calc(100% - 40px)', '20px', null, '-8px', null);

            // --- HEADER (DRAG HANDLE) ---
            var header = document.createElement('div');
            header.id = 'quizfetch-drag-handle';
            header.style.cssText = `
                display: flex; 
                flex-direction: column;
                cursor: move;
                user-select: none;
                background: ${currentTheme.header.background};
                border-bottom: 1px solid ${currentTheme.header.border};
            `;
            
            // Top row with title and close button
            const headerTopRow = document.createElement('div');
            headerTopRow.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 1rem;
                padding: 0.75rem 1rem 0.5rem 1rem;
            `;
            headerTopRow.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.75rem; min-width: 0;">
                    <span aria-hidden="true" style="
                        width: 2.25rem;
                        height: 1.25rem;
                        border-radius: 9999px;
                        background: rgba(255, 255, 255, 0.14);
                        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.26);
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                    ">
                        <span style="
                            width: 1.25rem;
                            height: 0.2rem;
                            border-radius: 9999px;
                            background: rgba(15, 23, 42, 0.18);
                        "></span>
                    </span>
                    <span style="
                        font-size: 0.95rem;
                        font-weight: 650;
                        letter-spacing: -0.01em;
                        color: ${currentTheme.text.primary};
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    ">Quiz Fetch</span>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center; flex-shrink: 0;">
                    <button class="quizfetch-close-btn" style="
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 0.375rem;
                        width: 1.75rem;
                        height: 1.75rem;
                        border: none;
                        background: transparent;
                        color: ${currentTheme.text.primary};
                        cursor: pointer;
                    ">${LUCIDE_ICONS.x}</button>
                </div>
            `;
            header.appendChild(headerTopRow);
            
            // Tab container
            const tabContainer = document.createElement('div');
            tabContainer.className = 'quizfetch-tab-container';
            tabContainer.style.cssText = `
                display: flex;
                gap: 0;
                padding: 0 1rem 0.5rem 1rem;
            `;
            
            const tabStyle = `
                padding: 0.5rem 1rem;
                border: none;
                background: transparent;
                cursor: pointer;
                font-size: 0.875rem;
                font-weight: 500;
                color: ${currentTheme.tab.inactive};
                border-bottom: 2px solid transparent;
                transition: all 0.15s;
                font-family: inherit;
            `;
            const activeTabStyle = `
                color: ${currentTheme.tab.active};
                border-bottom-color: ${currentTheme.tab.activeBorder};
            `;
            
            const currentQuizTab = document.createElement('button');
            currentQuizTab.textContent = 'Current Quiz';
            currentQuizTab.dataset.tab = 'current';
            currentQuizTab.style.cssText = tabStyle + activeTabStyle;
            
            const historyTab = document.createElement('button');
            historyTab.textContent = 'Quiz History';
            historyTab.dataset.tab = 'history';
            historyTab.style.cssText = tabStyle;
            
            tabContainer.appendChild(currentQuizTab);
            tabContainer.appendChild(historyTab);
            header.appendChild(tabContainer);

            // Close button click (stop propagation so it doesn't start drag)
            headerTopRow.querySelector('.quizfetch-close-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (document.body.contains(popup)) document.body.removeChild(popup);
                if (document.body.contains(backdrop)) document.body.removeChild(backdrop);
            });

            // Update onDragStart to ignore clicks on buttons and tabs
            function onDragStart(e) {
                if (e.type === 'mousedown' && e.button !== 0) return; // Only left click
                if (e.target.closest('button')) return; // Don't drag when clicking buttons in header
                isDragging = true;
                lastMouseX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
                lastMouseY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
                const rect = popup.getBoundingClientRect();
                dragOffsetX = lastMouseX - rect.left;
                dragOffsetY = lastMouseY - rect.top;
                document.body.style.userSelect = 'none';
                // Disable transitions while dragging
                popup.style.transition = 'none';
            }

            // Create content area with shadcn/ui styling
            var content = document.createElement("div");
            content.className = 'quiz-content-area';
            content.style.cssText = `
                padding: 1.5rem;
                overflow-y: auto;
                flex: 1;
                background: transparent;
                border-radius: 0 0 0.75rem 0.75rem;
                user-select: text; /* Allow text selection in content area */
            `;

            // Create history content area (hidden by default)
            var historyContent = document.createElement("div");
            historyContent.className = 'quiz-history-area';
            historyContent.style.cssText = `
                padding: 1.5rem;
                overflow-y: auto;
                flex: 1;
                background: transparent;
                border-radius: 0 0 0.75rem 0.75rem;
                user-select: text;
                display: none;
            `;

            // Function to render current quiz content
            function renderCurrentQuizView() {
                // Check if there are any questions (including error entries) before showing "no data" message
                let hasAnyQuestions = false;
                if (quizData && quizData[currentCourseId]) {
                    // Check all quizzes in the course for any questions (including errors)
                    for (const quizKey of Object.keys(quizData[currentCourseId])) {
                        if (quizKey === 'courseName') continue;
                        const quiz = quizData[currentCourseId][quizKey];
                        if (quiz && quiz.questions && quiz.questions.length > 0) {
                            hasAnyQuestions = true;
                            break;
                        }
                    }
                }

                if (!hasAnyQuestions) {
                    const textColor = currentTheme.text.secondary;
                    content.innerHTML = `<p style='text-align: center; color: ${textColor}; padding: 2.5rem 1.25rem;'>No quiz data collected yet for this course.</p>`;
                } else {
                    renderQuizContent(content, quizData, currentCourseId, submissionHistory, currentTheme);
                }
            }

            // Initial render of current quiz view
            renderCurrentQuizView();

            // Tab switching logic
            function switchTab(tabName) {
                if (tabName === 'current') {
                    currentQuizTab.style.cssText = tabStyle + activeTabStyle;
                    historyTab.style.cssText = tabStyle;
                    content.style.display = 'block';
                    historyContent.style.display = 'none';
                } else if (tabName === 'history') {
                    currentQuizTab.style.cssText = tabStyle;
                    historyTab.style.cssText = tabStyle + activeTabStyle;
                    content.style.display = 'none';
                    historyContent.style.display = 'block';
                    // Render history view
                    renderHistoryView(historyContent, 'all', currentCourseId, 'recent', currentTheme);
                }
            }

            currentQuizTab.addEventListener('click', (e) => {
                e.stopPropagation();
                switchTab('current');
            });

            historyTab.addEventListener('click', (e) => {
                e.stopPropagation();
                switchTab('history');
            });

            // Append header and content to popup
            popup.appendChild(header);
            popup.appendChild(content);
            popup.appendChild(historyContent);

            // Add event handlers  
            const closePopup = function () {
                try {
                    if (document.body.contains(popup)) document.body.removeChild(popup);
                    if (document.body.contains(backdrop)) document.body.removeChild(backdrop);
                } catch (e) {
                    console.error("Error closing popup:", e);
                }
            };

            backdrop.addEventListener('click', closePopup);

            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closePopup();
            });

            // Add feedback button to popup
            // addFeedbackButton(popup);

            // Add to DOM
            document.body.appendChild(backdrop);
            document.body.appendChild(popup);

            // Subtle mount animation (cheap). Avoid animating during drag/resize.
            const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (!prefersReducedMotion) {
                backdrop.style.opacity = '0';
                popup.style.opacity = '0';
                popup.style.transform = 'translate(-50%, calc(-50% + 14px)) scale(0.97)';

                requestAnimationFrame(() => {
                    backdrop.style.transition = 'opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)';
                    popup.style.transition = 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1), transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)';
                    backdrop.style.opacity = '1';
                    popup.style.opacity = '1';
                    popup.style.transform = 'translate(-50%, -50%)';
                });
            }

            // Record popup opening interaction and update question count
            recordUserInteraction('popup_opened', { courseId: currentCourseId });
            updateTotalQuestionsCount();

            // --- DRAGGABLE LOGIC ---
            let isDragging = false;
            let dragOffsetX = 0, dragOffsetY = 0;
            let lastMouseX = 0, lastMouseY = 0;

            let lastDragEvent = null;
            function onDragMove(e) {
                if (!isDragging) return;
                lastDragEvent = e;

                if (!window.dragAnimationFrame) {
                    window.dragAnimationFrame = requestAnimationFrame(() => {
                        if (!lastDragEvent) return;
                        let clientX = lastDragEvent.type.startsWith('touch') ? lastDragEvent.touches[0].clientX : lastDragEvent.clientX;
                        let clientY = lastDragEvent.type.startsWith('touch') ? lastDragEvent.touches[0].clientY : lastDragEvent.clientY;
                        let newLeft = clientX - dragOffsetX;
                        let newTop = clientY - dragOffsetY;
                        // Clamp to viewport
                        const rect = popup.getBoundingClientRect();
                        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - rect.width));
                        newTop = Math.max(0, Math.min(newTop, window.innerHeight - rect.height));
                        popup.style.left = newLeft + 'px';
                        popup.style.top = newTop + 'px';
                        popup.style.transform = '';
                        window.dragAnimationFrame = null;
                    });
                }
            }

            function onDragEnd() {
                isDragging = false;
                document.body.style.userSelect = '';
                popup.style.transition = '';
                lastDragEvent = null;
                if (window.dragAnimationFrame) {
                    cancelAnimationFrame(window.dragAnimationFrame);
                    window.dragAnimationFrame = null;
                }
            }

            // --- RESIZABLE LOGIC ---
            let isResizing = false;
            let resizeStartX = 0, resizeStartY = 0, startWidth = 0, startHeight = 0, startLeft = 0, startTop = 0, resizeDir = '';
            const minWidth = 400; // px
            const minHeight = 300; // px
            const maxWidth = window.innerWidth * 0.95;
            const maxHeight = window.innerHeight * 0.95;

            function onResizeStart(e) {
                if (e.type === 'mousedown' && e.button !== 0) return;
                isResizing = true;
                resizeDir = e.target.dataset.dir || 'se';
                resizeStartX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
                resizeStartY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
                const rect = popup.getBoundingClientRect();
                startWidth = rect.width; startHeight = rect.height;
                startLeft = rect.left; startTop = rect.top;
                document.body.style.userSelect = 'none';
                // Disable transitions for performance during resize
                popup.style.transition = 'none';
                e.preventDefault();
            }

            // Use requestAnimationFrame for smoother resize
            let lastResizeEvent = null;
            function onResizeMove(e) {
                if (!isResizing) return;
                lastResizeEvent = e;

                if (!window.resizeAnimationFrame) {
                    window.resizeAnimationFrame = requestAnimationFrame(() => {
                        if (!lastResizeEvent) return;

                        let clientX = lastResizeEvent.type.startsWith('touch') ? lastResizeEvent.touches[0].clientX : lastResizeEvent.clientX;
                        let clientY = lastResizeEvent.type.startsWith('touch') ? lastResizeEvent.touches[0].clientY : lastResizeEvent.clientY;
                        let dx = clientX - resizeStartX;
                        let dy = clientY - resizeStartY;

                        let newWidth = startWidth;
                        let newHeight = startHeight;
                        let newLeft = startLeft;
                        let newTop = startTop;

                        // Batch all style changes for better performance
                        if (resizeDir.includes('e')) {
                            newWidth = startWidth + dx;
                        }
                        if (resizeDir.includes('s')) {
                            newHeight = startHeight + dy;
                        }
                        if (resizeDir.includes('w')) {
                            // When resizing from west/left, maintain right edge position
                            const widthChange = dx;
                            const newPotentialWidth = startWidth - widthChange;

                            if (newPotentialWidth >= minWidth) {
                                // Only adjust if we're above minimum width
                                newWidth = newPotentialWidth;
                                newLeft = startLeft + widthChange;
                            } else {
                                // If below minimum width, lock at minimum
                                newWidth = minWidth;
                                newLeft = startLeft + (startWidth - minWidth);
                            }
                        }
                        if (resizeDir.includes('n')) {
                            // When resizing from north/top, maintain bottom edge position
                            const heightChange = dy;
                            const newPotentialHeight = startHeight - heightChange;

                            if (newPotentialHeight >= minHeight) {
                                // Only adjust if we're above minimum height
                                newHeight = newPotentialHeight;
                                newTop = startTop + heightChange;
                            } else {
                                // If below minimum height, lock at minimum
                                newHeight = minHeight;
                                newTop = startTop + (startHeight - minHeight);
                            }
                        }

                        // Constrain width and height but preserve position
                        newWidth = Math.min(newWidth, maxWidth);
                        newHeight = Math.min(newHeight, maxHeight);

                        // Ensure the popup stays within viewport bounds
                        if (newLeft < 0) {
                            if (resizeDir.includes('w')) {
                                // If resizing from left edge, adjust width instead of position
                                newWidth = startWidth + startLeft;
                                newLeft = 0;
                            } else {
                                newLeft = 0;
                            }
                        }

                        if (newTop < 0) {
                            if (resizeDir.includes('n')) {
                                // If resizing from top edge, adjust height instead of position
                                newHeight = startHeight + startTop;
                                newTop = 0;
                            } else {
                                newTop = 0;
                            }
                        }

                        // Ensure popup doesn't extend beyond right/bottom edges
                        if (newLeft + newWidth > window.innerWidth) {
                            if (resizeDir.includes('e')) {
                                // If resizing from right edge, limit width
                                newWidth = window.innerWidth - newLeft;
                            } else {
                                newLeft = window.innerWidth - newWidth;
                            }
                        }

                        if (newTop + newHeight > window.innerHeight) {
                            if (resizeDir.includes('s')) {
                                // If resizing from bottom edge, limit height
                                newHeight = window.innerHeight - newTop;
                            } else {
                                newTop = window.innerHeight - newHeight;
                            }
                        }

                        // Apply all style changes at once to minimize reflows
                        popup.style.cssText += `
                            width: ${newWidth}px;
                            height: ${newHeight}px;
                            left: ${newLeft}px;
                            top: ${newTop}px;
                            transform: none;
                        `;

                        window.resizeAnimationFrame = null;
                    });
                }
            }

            function onResizeEnd() {
                isResizing = false;
                document.body.style.userSelect = '';
                popup.style.transition = '';
                lastResizeEvent = null;
                if (window.resizeAnimationFrame) {
                    cancelAnimationFrame(window.resizeAnimationFrame);
                    window.resizeAnimationFrame = null;
                }
            }

            // Attach drag events to the header
            header.addEventListener('mousedown', onDragStart);
            header.addEventListener('touchstart', onDragStart, { passive: false });
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragEnd);
            document.addEventListener('touchmove', onDragMove, { passive: false });
            document.addEventListener('touchend', onDragEnd);
            // Attach resize events
            resizeHandles.forEach(handle => {
                handle.addEventListener('mousedown', onResizeStart);
                handle.addEventListener('touchstart', onResizeStart, { passive: false });
                document.addEventListener('mousemove', onResizeMove);
                document.addEventListener('mouseup', onResizeEnd);
                document.addEventListener('touchmove', onResizeMove, { passive: false });
                document.addEventListener('touchend', onResizeEnd);
            });

        } catch (error) {
            console.error("? Error showing popup:", error);
            alert("Error showing popup: " + error.message);
        }
    }

    // Function to render quiz content in the popup
    function renderQuizContent(container, quizData, currentCourseId, submissionHistory, theme) {
        try {
            // Use the utility to get the current quiz and assignment ID
            const { quizId: currentQuizId, assignmentId: currentAssignmentId } = getCurrentQuizAndAssignmentIdFromUrl();
            const currentQuizKey = currentAssignmentId ? `${currentQuizId}_${currentAssignmentId}` : currentQuizId;

            // Check if we have any quiz data for current course and quiz
            if (!quizData || !quizData[currentCourseId] ||
                (currentQuizKey && !quizData[currentCourseId][currentQuizKey])) {
                container.innerHTML = `<p style='text-align: center; color: ${theme.text.secondary}; padding: 40px 20px;'>No quiz data collected yet for this specific quiz.</p>`;
                return;
            }

            // Format and display the quiz data only for current quiz
            const courseData = quizData[currentCourseId];
            const quizKeysToShow = currentQuizKey ? [currentQuizKey] : Object.keys(courseData);

            // Extract user's answered questions if available
            let userAnswers = {};    // Store correct answers
            let correctAnswers = {}; // Track which questions were answered correctly
            let mostRecentAnswers = {}; // Track most recent answers even if incorrect
            let incorrectAnswers = {}; // Track all incorrect answers by questionId

            // Process all submission history to find correct answers and track incorrect ones
            if (submissionHistory && submissionHistory.length > 0) {
                try {
                    // First pass: gather ALL answers (including correct ones from past attempts)
                    submissionHistory.forEach(submission => {
                        if (submission.submission_data && Array.isArray(submission.submission_data)) {
                            submission.submission_data.forEach(item => {
                                try {
                                    const questionId = item.question_id;
                                    const answerId = item.answer_id;
                                    const isCorrect = item.correct === true;

                                    // Check for text/identification question responses
                                    const textResponse = item.text;
                                    const hasTextResponse = textResponse !== undefined && textResponse !== null;

                                    // Initialize arrays for this question if needed
                                    if (!userAnswers[questionId]) {
                                        userAnswers[questionId] = [];
                                    }
                                    if (!incorrectAnswers[questionId]) {
                                        incorrectAnswers[questionId] = [];
                                    }

                                    // Handle long paragraph questions (correct: "defined")
                                    if (item.correct === "defined" && hasTextResponse) {
                                        const textAnswer = {
                                            type: 'long_paragraph',
                                            value: textResponse,
                                            isCorrect: true  // "defined" means the answer was provided/defined
                                        };

                                        userAnswers[questionId] = [textAnswer];
                                        correctAnswers[questionId] = true;  // Treat "defined" as correct
                                    }
                                    // Handle multiple identification questions (answer_for_q1, answer_for_q2, etc.)
                                    else if (Object.keys(item).some(key => key.startsWith('answer_for_q'))) {
                                        const multipleAnswers = [];

                                        // Extract all answer_for_qX fields
                                        for (const key in item) {
                                            if (key.startsWith('answer_for_q') && item[key]) {
                                                const questionNumber = key.replace('answer_for_q', '');
                                                const answerText = item[key];
                                                const answerIdKey = `answer_id_for_q${questionNumber}`;
                                                const answerId = item[answerIdKey];


                                                multipleAnswers.push({
                                                    type: 'multiple_identification',
                                                    questionNumber: questionNumber,
                                                    value: answerText,
                                                    answerId: answerId,
                                                    isCorrect: isCorrect
                                                });
                                            }
                                        }

                                        if (multipleAnswers.length > 0) {
                                            userAnswers[questionId] = multipleAnswers;
                                            correctAnswers[questionId] = isCorrect;

                                            if (!isCorrect) {
                                                // Add all answers to incorrect list
                                                multipleAnswers.forEach(answer => {
                                                    if (!incorrectAnswers[questionId].includes(answer.value)) {
                                                        incorrectAnswers[questionId].push(answer.value);
                                                    }
                                                });
                                            }
                                        }
                                    }
                                    // Handle regular text/identification questions
                                    else if (hasTextResponse) {
                                        // Store the text response as a special object
                                        const textAnswer = {
                                            type: 'text',
                                            value: textResponse,
                                            isCorrect: isCorrect
                                        };

                                        // Store whether this is a correct text answer
                                        if (isCorrect) {
                                            // For correct answers, always overwrite any previous answers
                                            userAnswers[questionId] = [textAnswer];
                                            correctAnswers[questionId] = true;
                                        } else {
                                            // For incorrect, add to incorrect answers
                                            incorrectAnswers[questionId].push(textAnswer);
                                            // Only store this as the user's answer if we don't already have a correct answer
                                            if (correctAnswers[questionId] !== true) {
                                                userAnswers[questionId] = [textAnswer];
                                                correctAnswers[questionId] = false;
                                            }
                                        }
                                    }

                                    // Look for dynamic answer fields (answer_XXX format with 0/1 values)
                                    const dynamicAnswerFields = [];
                                    for (const key in item) {
                                        if (key.startsWith('answer_') && (item[key] === 0 || item[key] === 1 || item[key] === '0' || item[key] === '1')) {
                                            // Extract the answer ID from the field name (e.g., "answer_72414" -> "72414")
                                            const answerId = key.replace('answer_', '');
                                            const isCorrect = item[key] === 1 || item[key] === '1';


                                            dynamicAnswerFields.push({
                                                answerId: answerId,
                                                isCorrect: isCorrect
                                            });
                                        }
                                    }

                                    // If we found dynamic answer fields, process them as a multiple-answer question
                                    if (dynamicAnswerFields.length > 0) {

                                        // Process each dynamic answer field
                                        dynamicAnswerFields.forEach(field => {
                                            if (field.isCorrect) {
                                                // This means the user selected this choice (answer_XXX = 1)
                                                // Add to user's selected answers if not already there
                                                if (!userAnswers[questionId].includes(field.answerId)) {
                                                    userAnswers[questionId].push(field.answerId);
                                                }
                                            } else {
                                                // This means the user did not select this choice (answer_XXX = 0)
                                                // We don't need to track unselected choices
                                            }
                                        });

                                        // Set overall correct/incorrect status for the question based on Canvas API's assessment
                                        // Use the main 'correct' field from the item, not derived from individual answer selections
                                        correctAnswers[questionId] = isCorrect;

                                        // If the overall question was wrong, add selected answers to incorrect list
                                        if (!isCorrect) {
                                            dynamicAnswerFields.forEach(field => {
                                                if (field.isCorrect) { // This means it was selected (value = 1)
                                                    if (!incorrectAnswers[questionId].includes(field.answerId)) {
                                                        incorrectAnswers[questionId].push(field.answerId);
                                                    }
                                                }
                                            });
                                        }
                                    }
                                    // Regular processing for single-answer questions
                                    else if (answerId !== undefined) {
                                        mostRecentAnswers[questionId] = answerId;

                                        // If this answer is correct, save it
                                        if (isCorrect) {
                                            if (!userAnswers[questionId].includes(answerId)) {
                                                userAnswers[questionId].push(answerId);
                                            }
                                            correctAnswers[questionId] = true;
                                        }
                                        // If not correct, track it as an incorrect answer
                                        else {
                                            // Add to incorrect answers if not already there
                                            if (!incorrectAnswers[questionId].includes(answerId)) {
                                                incorrectAnswers[questionId].push(answerId);
                                            }

                                            // If we haven't recorded any answer for this question yet
                                            if (userAnswers[questionId].length === 0 && correctAnswers[questionId] !== true) {
                                                userAnswers[questionId].push(answerId);
                                                correctAnswers[questionId] = false;
                                            }
                                        }
                                    }
                                } catch (itemError) {
                                    console.error("Error processing individual submission item:", itemError, item);
                                    // Continue processing other items
                                }
                            });
                        }
                    });
                } catch (submissionError) {
                    console.error("Error processing submission history:", submissionError);
                    // Continue with empty answers if submission processing fails
                }

                // Save correct and incorrect answers to storage for future reference (history view)
                const currentQuizKeyForSave = currentAssignmentId ? `${currentQuizId}_${currentAssignmentId}` : currentQuizId;
                if (Object.keys(correctAnswers).length > 0 || Object.keys(incorrectAnswers).length > 0) {
                    saveCorrectAnswersToStorage(currentCourseId, currentQuizKeyForSave, userAnswers, correctAnswers, incorrectAnswers);
                }
            }

            // Fallback: if no submission API data, use stored correct_answers from DOM scraping
            if (Object.keys(correctAnswers).length === 0) {
                quizKeysToShow.forEach(quizKey => {
                    const quiz = courseData[quizKey];
                    if (!quiz || !quiz.questions) return;
                    quiz.questions.forEach(q => {
                        if (q.isError || !q.choices || !q.choices.correct_answers) return;
                        const choices = q.choices;
                        const correctIds = choices.correct_answers;
                        if (Array.isArray(correctIds) && correctIds.length > 0) {
                            // Mark these as the correct answer choices
                            correctAnswers[q.questionId] = true;
                            if (!userAnswers[q.questionId]) userAnswers[q.questionId] = [];
                            correctIds.forEach(id => {
                                if (!userAnswers[q.questionId].includes(id)) {
                                    userAnswers[q.questionId].push(id);
                                }
                            });
                        }
                    });
                });
            }

            // Create content HTML with modern card-based layout
            let htmlContent = '';

            // Add export buttons at the top with shadcn/ui styling
            htmlContent += `
                <div style="
                    margin-bottom: 1.5rem; 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    gap: 1rem;
                    flex-wrap: wrap;
                ">
                    <div>
                        <h2 style="
                            font-size: 1.75rem;
                            font-weight: 600;
                            color: ${theme.text.primary};
                            margin: 0;
                            line-height: 1.75rem;
                        ">Quiz Questions</h2>
                    </div>
                    <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
                        <div class="copy-dropdown" style="position: relative; display: inline-block;">
                            <button class="copy-questions-btn" style="
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                border-radius: 0.375rem;
                                font-size: 0.875rem;
                                font-weight: 500;
                                height: 2.25rem;
                                padding: 0 0.75rem;
                                border: 1px solid ${theme.button.border};
                                background: ${theme.button.background};
                                color: ${theme.button.text};
                                cursor: pointer;
                                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                                gap: 0.5rem;
                                box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                            ">
                                ${LUCIDE_ICONS.copy} Copy All ${LUCIDE_ICONS.chevronDown}
                            </button>
                            <div class="copy-dropdown-menu" style="
                                display: none;
                                position: absolute;
                                top: 100%;
                                left: 0;
                                margin-top: 0.25rem;
                                min-width: 160px;
                                background: ${theme.card.background};
                                border: 1px solid ${theme.card.border};
                                border-radius: 0.375rem;
                                box-shadow: ${theme.card.shadow};
                                z-index: 1000;
                                overflow: hidden;
                            ">
                                <button class="copy-format-btn" data-format="rich" style="
                                    display: flex;
                                    align-items: center;
                                    gap: 0.5rem;
                                    width: 100%;
                                    padding: 0.5rem 0.75rem;
                                    border: none;
                                    background: transparent;
                                    color: ${theme.text.primary};
                                    font-size: 0.875rem;
                                    cursor: pointer;
                                    text-align: left;
                                ">${LUCIDE_ICONS.fileText} Rich Text</button>
                                <button class="copy-format-btn" data-format="markdown" style="
                                    display: flex;
                                    align-items: center;
                                    gap: 0.5rem;
                                    width: 100%;
                                    padding: 0.5rem 0.75rem;
                                    border: none;
                                    background: transparent;
                                    color: ${theme.text.primary};
                                    font-size: 0.875rem;
                                    cursor: pointer;
                                    text-align: left;
                                ">${LUCIDE_ICONS.hash} Markdown</button>
                                <button class="copy-format-btn" data-format="anki" style="
                                    display: flex;
                                    align-items: center;
                                    gap: 0.5rem;
                                    width: 100%;
                                    padding: 0.5rem 0.75rem;
                                    border: none;
                                    background: transparent;
                                    color: ${theme.text.primary};
                                    font-size: 0.875rem;
                                    cursor: pointer;
                                    text-align: left;
                                ">${LUCIDE_ICONS.layers} Anki</button>
                                <button class="copy-format-btn" data-format="quizlet" style="
                                    display: flex;
                                    align-items: center;
                                    gap: 0.5rem;
                                    width: 100%;
                                    padding: 0.5rem 0.75rem;
                                    border: none;
                                    background: transparent;
                                    color: ${theme.text.primary};
                                    font-size: 0.875rem;
                                    cursor: pointer;
                                    text-align: left;
                                ">${LUCIDE_ICONS.copy} Quizlet</button>
                            </div>
                        </div>
                        <button class="copy-html-btn" style="
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            border-radius: 0.375rem;
                            font-size: 0.875rem;
                            font-weight: 500;
                            height: 2.25rem;
                            padding: 0 1rem;
                            border: 1px solid rgba(0, 0, 0, 0.3);
                            background: ${theme.button.primaryBg};
                            color: ${theme.button.primaryText};
                            cursor: pointer;
                            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                            gap: 0.5rem;
                            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                        " onmouseover="this.style.background='${theme.button.primaryHover}'" 
                           onmouseout="this.style.background='${theme.button.primaryBg}'">
                            ${LUCIDE_ICONS.download} Download Report
                        </button>
                    </div>
                </div>
                
                <!-- Toolbar row: Search bar + Quiz Type button -->
                <div style="
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    margin-bottom: 1.5rem;
                ">
                    <div class="search-wrapper" style="
                        display: flex;
                        flex: 1;
                        position: relative;
                        border-radius: 0.375rem;
                        border: 1px solid ${theme.input.border};
                        background: ${theme.input.background};
                        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                        overflow: hidden;
                    ">
                        <div class="search-icon" style="
                            display: flex;
                            align-items: center;
                            padding-left: 0.75rem;
                            color: ${theme.text.muted};
                        ">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <path d="m21 21-4.3-4.3"></path>
                            </svg>
                        </div>
                        <input id="question-search-input" type="text" placeholder="Search questions..." style="
                            flex: 1;
                            height: 2.25rem;
                            margin-top: 0;
                            margin-bottom: 0;
                            box-shadow: inset 0 1px 1px rgba(0,0,0,0);
                            padding: 0 0.75rem;
                            border: none;
                            outline: none;
                            background: transparent;
                            font-size: 0.875rem;
                            color: ${theme.input.text};
                        ">
                        <button id="clear-search-btn" style="
                            display: none;
                            align-items: center;
                            justify-content: center;
                            padding: 0 0.75rem;
                            background: transparent;
                            border: none;
                            cursor: pointer;
                            color: ${theme.text.secondary};
                        ">
                            ${LUCIDE_ICONS.x}
                        </button>
                    </div>
                    <button class="toggle-mode-btn" data-mode="quiz-answers" style="
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 0.375rem;
                        font-size: 0.875rem;
                        font-weight: 500;
                        height: 2.25rem;
                        padding: 0 1rem;
                        border: 1px solid ${theme.button.border};
                        background: ${theme.button.background};
                        color: ${theme.button.text};
                        cursor: pointer;
                        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                        gap: 0.5rem;
                        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                        flex-shrink: 0;
                    " onmouseover="this.style.background='${theme.button.backgroundHover}'" 
                       onmouseout="this.style.background='${theme.button.background}'">
${LUCIDE_ICONS.eyeOff} Quiz Type
                    </button>
                </div>
            `;

            // Calculate overall score across all quizzes
            let totalQuestions = 0;
            let correctCount = 0;

            // Count questions and correct answers for score calculation
            for (const quizKey of quizKeysToShow) {
                const quiz = courseData[quizKey];
                if (!quiz || !quiz.questions || quiz.questions.length === 0) continue;

                // Filter unique questions (including error entries)
                const uniqueQuestions = [];
                const questionTexts = new Set();
                const questionIds = new Set();

                quiz.questions.forEach(q => {
                    // For error entries, use questionId as the unique identifier
                    if (q.isError) {
                        if (!questionIds.has(q.questionId)) {
                            questionIds.add(q.questionId);
                            uniqueQuestions.push(q);
                        }
                    } else {
                        // For successful questions, use question text as before (with fallback to questionId)
                        const questionKey = q.question || q.questionId;
                        if (!questionTexts.has(questionKey)) {
                            questionTexts.add(questionKey);
                            uniqueQuestions.push(q);
                        }
                    }
                });

                uniqueQuestions.forEach(q => {
                    // Only count successful questions towards score (errors don't count as attempted questions)
                    if (!q.isError) {
                        totalQuestions++;
                        if (q.questionId in correctAnswers && correctAnswers[q.questionId] === true) {
                            correctCount++;
                        }
                    }
                });
            }

            // Add score display section with shadcn/ui styling
            if (totalQuestions > 0) {
                const scorePercentage = ((correctCount / totalQuestions) * 100).toFixed(1);
                const scoreColor = scorePercentage >= 80 ? theme.score.excellent.text : scorePercentage >= 60 ? theme.score.good.text : theme.score.poor.text;

                // Theme-aware colors
                const scoreBgColor = theme.card.background;
                const progressBgColor = 'rgba(210, 220, 230, 0.4)';
                const textColor = theme.text.secondary;
                const borderColor = theme.card.border;

                htmlContent += `
                    <div style="
                        margin: 0 0 2rem 0;
                        padding: 2rem;
                        background: ${scoreBgColor};
                        border: 1px solid ${borderColor};
                        border-radius: 0.75rem;
                        text-align: center;
                        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
                    ">
                        <div style="margin-bottom: 1.5rem;">
                            <div style="
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                width: 4rem;
                                height: 4rem;
                                background: ${scorePercentage >= 80 ? theme.score.excellent.bg : scorePercentage >= 60 ? theme.score.good.bg : theme.score.poor.bg};
                                border-radius: 50%;
                                margin: 0 auto 1.5rem auto;
                                color: ${scoreColor};
                            ">
                                ${LUCIDE_ICONS.barChart}
                            </div>
                            <div style="
                                font-size: 2.25rem;
                                font-weight: 700;
                                color: ${theme.text.primary};
                                margin-bottom: 0.5rem;
                                line-height: 2.5rem;
                            ">
                                ${correctCount}/${totalQuestions}
                            </div>
                            <div style="
                                font-size: 1.125rem;
                                color: ${theme.text.secondary};
                                margin-bottom: 1.5rem;
                                line-height: 1.75rem;
                            ">
                                ${scorePercentage >= 100 ? 'Perfect Score!' : `${scorePercentage}% Correct`}
                            </div>
                            <div style="
                                max-width: 24rem;
                                margin: 0 auto;
                            ">
                                <div style="
                                    background: ${progressBgColor};
                                    border-radius: 9999px;
                                    height: 0.5rem;
                                    width: 100%;
                                    margin-bottom: 0.75rem;
                                    overflow: hidden;
                                ">
                                    <div style="
                                        height: 100%;
                                        width: ${scorePercentage}%;
                                        background: ${theme.score.bar};
                                        transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                                    "></div>
                                </div>
                                <div style="
                                    display: flex;
                                    justify-content: space-between;
                                    font-size: 0.875rem;
                                    color: ${textColor};
                                    line-height: 1.25rem;
                                ">
                                    <span>${scorePercentage}% Correct</span>
                                    <span>${correctCount} out of ${totalQuestions} questions</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }

            // Render questions for each quiz
            for (const quizKey of quizKeysToShow) {
                try {
                    const quiz = courseData[quizKey];
                    if (!quiz || !quiz.questions || quiz.questions.length === 0) continue;

                    const quizIdDisplay = quiz.quizId || quizKey;
                    const assignmentIdDisplay = quiz.assignmentId ? ` (Assignment ${quiz.assignmentId})` : '';

                    // Filter unique questions (including error entries)
                    const uniqueQuestions = [];
                    const questionTexts = new Set();
                    const questionIds = new Set();

                    quiz.questions.forEach(q => {
                        // For error entries, use questionId as the unique identifier
                        if (q.isError) {
                            if (!questionIds.has(q.questionId)) {
                                questionIds.add(q.questionId);
                                uniqueQuestions.push(q);
                            }
                        } else {
                            // For successful questions, use question text as before (with fallback to questionId)
                            const questionKey = q.question || q.questionId;
                            if (!questionTexts.has(questionKey)) {
                                questionTexts.add(questionKey);
                                uniqueQuestions.push(q);
                            }
                        }
                    });

                    htmlContent += `
                    <div style="margin-bottom: 30px;">
                `;

                    // Render each question with card styling and drop shadows (including error entries)
                    uniqueQuestions.forEach((q, index) => {
                        try {
                            // Check if this is an error entry
                            if (q.isError) {
                                // Render simple error message
                                htmlContent += `
                            <div class="question-card" style="
                                background: ${theme.card.background};
                                border: 1px solid ${theme.card.border};
                                border-radius: 0.5rem;
                                padding: 1.5rem;
                                margin-bottom: 1.5rem;
                                box-shadow: ${theme.card.shadow};
                            ">
                                <h3 style="margin: 0; color: ${theme.text.primary}; font-size: 1rem; font-weight: 500; display: flex; align-items: center; gap: 0.5rem;">
                                    ${index + 1}. Error fetching question data ${LUCIDE_ICONS.alertCircle}
                                </h3>
                            </div>
                        `;
                                return; // Skip to next question
                            }

                            // Regular question processing for successful questions
                            const hasCorrectAnswer = q.questionId in correctAnswers && correctAnswers[q.questionId] === true;
                            const hasIncorrectAnswer = q.questionId in correctAnswers && correctAnswers[q.questionId] === false;

                            // Card styling with drop shadow
                            htmlContent += `
                        <div class="question-card" style="
                            background: ${theme.card.background};
                            border: 1px solid ${theme.card.border};
                            border-radius: 0.5rem;
                            padding: 1.5rem;
                            margin-bottom: 1.5rem;
                            box-shadow: ${theme.card.shadow};
                        ">
                            
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                                <h3 style="margin: 0; color: ${theme.text.primary}; font-size: 1rem; font-weight: 500; flex: 1;">${index + 1}. ${sanitizeHtmlForDisplay(q.question || 'No question text')}</h3>
                                ${hasCorrectAnswer ?
                                    `<span style="background: ${theme.status.correct.bg}; color: ${theme.status.correct.text}; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; margin-left: 1rem; display: flex; align-items: center; gap: 0.25rem; user-select: none; -webkit-user-select: none; -moz-user-select: none; border: 1px solid ${theme.status.correct.border};">${LUCIDE_ICONS.checkCircle} Correct</span>` :
                                    hasIncorrectAnswer ?
                                        `<span style="background: ${theme.status.incorrect.bg}; color: ${theme.status.incorrect.text}; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; margin-left: 1rem; display: flex; align-items: center; gap: 0.25rem; user-select: none; -webkit-user-select: none; -moz-user-select: none; border: 1px solid ${theme.status.incorrect.border};">${LUCIDE_ICONS.xCircle} Incorrect</span>` :
                                        `<span style="background: ${theme.status.neutral.bg}; color: ${theme.status.neutral.text}; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; margin-left: 1rem; display: flex; align-items: center; gap: 0.25rem; user-select: none; -webkit-user-select: none; -moz-user-select: none; border: 1px solid ${theme.status.neutral.border};">${LUCIDE_ICONS.circle} Not answered</span>`
                                }
                            </div>
                            
                            <!-- Answer content container -->
                            <div class="answer-content" style="display: block;">
                    `;

                            // Handle identification questions and new question types
                            const isIdentificationQuestion = q.choices && q.choices.question_type === "identification";
                            const isMatchingQuestion = q.choices && q.choices.question_type === "matching";

                            // Check if we have answers from submission history
                            const hasSubmissionAnswers = userAnswers[q.questionId] && Array.isArray(userAnswers[q.questionId]) && userAnswers[q.questionId].length > 0;

                            if (isMatchingQuestion) {
                                htmlContent += `<div style="margin-top: 1rem; color: ${theme.text.secondary}; font-weight: 500; font-size: 0.875rem;">Matching Pairs:</div>`;
                                
                                const matchingPairs = q.choices.matching_pairs || [];
                                matchingPairs.forEach(pair => {
                                    const hasSelection = pair.selectedValue && pair.selectedValue !== '';
                                    const bgColor = hasCorrectAnswer ? theme.status.correct.bg : (hasIncorrectAnswer ? theme.status.incorrect.bg : theme.status.neutral.bg);
                                    const textColor = hasCorrectAnswer ? theme.status.correct.text : (hasIncorrectAnswer ? theme.status.incorrect.text : theme.text.secondary);
                                    const borderColor = hasCorrectAnswer ? theme.status.correct.border : (hasIncorrectAnswer ? theme.status.incorrect.border : theme.status.neutral.border);
                                    const icon = hasCorrectAnswer ? LUCIDE_ICONS.checkCircle : (hasIncorrectAnswer ? LUCIDE_ICONS.xCircle : LUCIDE_ICONS.circle);
                                    
                                    htmlContent += `
                                        <div style="
                                            background: ${bgColor};
                                            color: ${textColor};
                                            padding: 0.75rem;
                                            border-radius: 0.375rem;
                                            margin: 0.5rem 0;
                                            border: 1px solid ${borderColor};
                                            display: flex;
                                            align-items: center;
                                            gap: 0.5rem;
                                        ">
                                            ${icon}
                                            <div style="flex: 1;">
                                                <strong>${sanitizeHtmlForDisplay(pair.term)}</strong> → ${hasSelection ? sanitizeHtmlForDisplay(pair.selectedText) : '<em>Not answered</em>'}
                                            </div>
                                        </div>
                                    `;
                                    
                                    // Show all available options for reference
                                    if (pair.allOptions && pair.allOptions.length > 0) {
                                        htmlContent += `<div style="margin-left: 2rem; margin-top: 0.25rem; font-size: 0.8125rem; color: ${theme.text.muted};">`;
                                        htmlContent += `<details style="cursor: pointer;"><summary style="user-select: none;">Show all options</summary>`;
                                        htmlContent += `<ul style="margin: 0.5rem 0; padding-left: 1.5rem;">`;
                                        pair.allOptions.forEach(opt => {
                                            const isSelected = opt.value === pair.selectedValue;
                                            htmlContent += `<li style="color: ${isSelected ? textColor : theme.text.muted}; font-weight: ${isSelected ? '600' : 'normal'};">
                                                ${sanitizeHtmlForDisplay(opt.text)}${isSelected ? ' ✓' : ''}
                                            </li>`;
                                        });
                                        htmlContent += `</ul></details></div>`;
                                    }
                                });
                            } else if (isIdentificationQuestion) {
                                htmlContent += `<div style="margin-top: 1rem; color: ${theme.text.secondary}; font-weight: 500; font-size: 0.875rem;">Your Answer:</div>`;

                                // Check if we have submission history answer first, fallback to stored answer
                                let displayAnswer = null;
                                let answerIsCorrect = false;

                                if (userAnswers[q.questionId] && Array.isArray(userAnswers[q.questionId])) {
                                    const textAnswers = userAnswers[q.questionId].filter(a => a && a.type === 'text');
                                    if (textAnswers.length > 0) {
                                        // Prioritize correct answers, otherwise use the first one
                                        const correctAnswer = textAnswers.find(a => a.isCorrect);
                                        displayAnswer = correctAnswer || textAnswers[0];
                                        answerIsCorrect = hasCorrectAnswer;
                                    }
                                }

                                // If no submission history answer found but we have the stored input, show that
                                if (!displayAnswer && q.choices.text_answer) {
                                    displayAnswer = { value: q.choices.text_answer };
                                    answerIsCorrect = hasCorrectAnswer;
                                }

                                if (displayAnswer) {
                                    const answerBg = answerIsCorrect ? theme.status.correct.bg : theme.status.incorrect.bg;
                                    const answerColor = answerIsCorrect ? theme.status.correct.text : theme.status.incorrect.text;
                                    const answerBorder = answerIsCorrect ? theme.status.correct.border : theme.status.incorrect.border;
                                    const icon = answerIsCorrect ? LUCIDE_ICONS.checkCircle : LUCIDE_ICONS.xCircle;

                                    htmlContent += `
                                <div style="
                                    background: ${answerBg};
                                    color: ${answerColor};
                                    padding: 0.75rem;
                                    border-radius: 0.375rem;
                                    margin: 0.5rem 0;
                                    font-weight: 500;
                                    display: flex;
                                    align-items: center;
                                    gap: 0.5rem;
                                    border: 1px solid ${answerBorder};
                                ">${icon} ${displayAnswer.value}</div>
                            `;
                                }

                                // Handle submission history answers for special question types
                                if (hasSubmissionAnswers) {
                                    const answers = userAnswers[q.questionId];

                                    // Check for long paragraph questions
                                    const longParagraphAnswers = answers.filter(a => a && a.type === 'long_paragraph');
                                    if (longParagraphAnswers.length > 0) {
                                        longParagraphAnswers.forEach(answer => {
                                            const lpAnswerBg = answer.isCorrect ? theme.status.correct.bg : theme.status.incorrect.bg;
                                            const lpAnswerColor = answer.isCorrect ? theme.status.correct.text : theme.status.incorrect.text;
                                            const lpAnswerBorder = answer.isCorrect ? theme.status.correct.border : theme.status.incorrect.border;
                                            const lpIcon = answer.isCorrect ? LUCIDE_ICONS.checkCircle : LUCIDE_ICONS.xCircle;

                                            htmlContent += `
                                        <div style="
                                            background: ${lpAnswerBg};
                                            color: ${lpAnswerColor};
                                            padding: 0.75rem;
                                            border-radius: 0.375rem;
                                            margin: 0.5rem 0;
                                            font-weight: 500;
                                            border: 1px solid ${lpAnswerBorder};
                                        ">
                                            <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                                                ${lpIcon}
                                                <div style="flex: 1;">
                                                    <div style="font-weight: 600; margin-bottom: 0.5rem;">Long Answer:</div>
                                                    <div style="white-space: pre-wrap; font-family: monospace; background: rgba(255,255,255,0.2); padding: 0.5rem; border-radius: 0.25rem;">${sanitizeHtmlForDisplay(answer.value)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                        });
                                    }

                                    // Check for multiple identification questions
                                    const multipleIdAnswers = answers.filter(a => a && a.type === 'multiple_identification');
                                    if (multipleIdAnswers.length > 0) {
                                        const miAnswerIsCorrect = hasCorrectAnswer;
                                        const miAnswerBg = miAnswerIsCorrect ? theme.status.correct.bg : theme.status.incorrect.bg;
                                        const miAnswerColor = miAnswerIsCorrect ? theme.status.correct.text : theme.status.incorrect.text;
                                        const miAnswerBorder = miAnswerIsCorrect ? theme.status.correct.border : theme.status.incorrect.border;
                                        const miIcon = miAnswerIsCorrect ? LUCIDE_ICONS.checkCircle : LUCIDE_ICONS.xCircle;

                                        htmlContent += `
                                    <div style="
                                        background: ${miAnswerBg};
                                        color: ${miAnswerColor};
                                        padding: 0.75rem;
                                        border-radius: 0.375rem;
                                        margin: 0.5rem 0;
                                        font-weight: 500;
                                        border: 1px solid ${miAnswerBorder};
                                    ">
                                        <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                                            ${miIcon}
                                            <div style="flex: 1;">
                                                <div style="font-weight: 600; margin-bottom: 0.5rem;">Multiple Identification Answers:</div>
                                `;

                                        // Sort answers by question number
                                        multipleIdAnswers.sort((a, b) => parseInt(a.questionNumber) - parseInt(b.questionNumber));

                                        multipleIdAnswers.forEach(answer => {
                                            htmlContent += `
                                        <div style="margin-bottom: 0.25rem;">
                                            <strong>Q${answer.questionNumber}:</strong> ${answer.value}
                                        </div>
                                    `;
                                        });

                                        htmlContent += `
                                            </div>
                                        </div>
                                    </div>
                                `;
                                    }
                                }
                            } else if (q.choices && Object.keys(q.choices).length > 0) {
                                // Always show all choices for regular multiple-choice questions
                                htmlContent += `<div style="margin-top: 1rem; color: ${theme.text.secondary}; font-weight: 500; font-size: 0.875rem;">Choices:</div>`;

                                // Check if we have submission answers that are answer IDs (not text answers)
                                let submissionAnswerIds = [];
                                if (hasSubmissionAnswers) {
                                    const answers = userAnswers[q.questionId];
                                    // Filter out text answers and get the regular answer IDs
                                    submissionAnswerIds = answers.filter(a => !(a && typeof a === 'object' && a.type));
                                }

                                Object.entries(q.choices).forEach(([choiceId, choiceText]) => {
                                    // Skip metadata keys - these are not actual answer choices
                                    if (choiceId === "question_type" || choiceId === "text_answer" || 
                                        choiceId === "correct_answers" || choiceId === "incorrect_answers" || choiceId === "correct_text_answer" || choiceId === "incorrect_text_answers" || choiceId === "matching_pairs") return;

                                    // Determine if this choice was selected and if it was correct
                                    let wasSelected = false;
                                    if (userAnswers[q.questionId]) {
                                        if (Array.isArray(userAnswers[q.questionId])) {
                                            // Check both regular stored answers and submission answers
                                            wasSelected = userAnswers[q.questionId].some(id => String(id) === String(choiceId)) ||
                                                submissionAnswerIds.some(id => String(id) === String(choiceId));
                                        } else {
                                            wasSelected = String(userAnswers[q.questionId]) === String(choiceId);
                                        }
                                    }

                                    const wasCorrect = wasSelected && correctAnswers[q.questionId] === true;
                                    const wasIncorrect = incorrectAnswers[q.questionId] &&
                                        incorrectAnswers[q.questionId].some(id => String(id) === String(choiceId));

                                    let choiceStyle = '';
                                    let choiceIcon = LUCIDE_ICONS.circle;

                                    if (wasCorrect) {
                                        choiceStyle = `background: ${theme.status.correct.bg}; color: ${theme.status.correct.text}; border: 1px solid ${theme.status.correct.border};`;
                                        choiceIcon = LUCIDE_ICONS.checkCircle;
                                    } else if (wasIncorrect) {
                                        choiceStyle = `background: ${theme.status.incorrect.bg}; color: ${theme.status.incorrect.text}; border: 1px solid ${theme.status.incorrect.border};`;
                                        choiceIcon = LUCIDE_ICONS.xCircle;
                                    } else {
                                        choiceStyle = `background: ${theme.status.neutral.bg}; color: ${theme.status.neutral.text}; border: 1px solid ${theme.status.neutral.border};`;
                                        choiceIcon = LUCIDE_ICONS.circle;
                                    }

                                    htmlContent += `
                                <div class="answer-choice" 
                                     data-choice-id="${choiceId}"
                                     data-was-correct="${wasCorrect}"
                                     data-was-incorrect="${wasIncorrect}"
                                     style="
                                    ${choiceStyle}
                                    padding: 0.75rem;
                                    border-radius: 0.375rem;
                                    margin: 0.5rem 0;
                                    display: flex;
                                    align-items: center;
                                    gap: 0.5rem;
                                    font-weight: 400;
                                    cursor: pointer;
                                    transition: all 0.2s ease;
                                ">
                                    <span class="choice-icon">${choiceIcon}</span>
                                    <span class="choice-text">${sanitizeHtmlForDisplay(choiceText)}</span>
                                </div>
                            `;
                                });
                            } else {
                                htmlContent += `<div style="color: ${theme.text.muted}; font-style: italic; margin-top: 1rem;">No choices available</div>`;
                            }

                            htmlContent += `
                                </div> <!-- Close answer-content container -->
                            </div>`; // Close question card
                        } catch (questionError) {
                            console.error("Error rendering individual question:", questionError, q);
                            // Show fallback error message for this specific question
                            htmlContent += `
                            <div class="question-card" style="
                                background: ${theme.card.background};
                                border: 1px solid ${theme.status.incorrect.border};
                                border-radius: 0.5rem;
                                padding: 1.5rem;
                                margin-bottom: 1.5rem;
                                box-shadow: ${theme.card.shadow};
                            ">
                                <h3 style="margin: 0; color: ${theme.status.incorrect.text}; font-size: 1rem; font-weight: 500; display: flex; align-items: center; gap: 0.5rem;">
                                    ${index + 1}. Error displaying question data ${LUCIDE_ICONS.alertCircle}
                                </h3>
                                <p style="margin: 0.5rem 0 0 0; color: ${theme.text.muted}; font-size: 0.875rem;">
                                    This question could not be displayed due to corrupted or unsupported data format.
                                </p>
                            </div>
                        `;
                        }
                    });

                    htmlContent += '</div>'; // Close quiz section
                } catch (quizError) {
                    console.error("Error rendering quiz:", quizError, quizKey);
                    // Add error message for this specific quiz
                    htmlContent += `
                        <div class="question-card" style="
                            background: ${theme.card.background};
                            border: 1px solid ${theme.status.incorrect.border};
                            border-radius: 0.75rem;
                            padding: 1.5rem;
                            margin-bottom: 2rem;
                            box-shadow: ${theme.card.shadow};
                        ">
                            <h3 style="margin: 0 0 0.5rem 0; color: ${theme.status.incorrect.text}; font-size: 1.125rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                                ${LUCIDE_ICONS.alertCircle} Error loading quiz data
                            </h3>
                            <p style="margin: 0; color: ${theme.text.muted}; font-size: 0.875rem;">
                                Quiz ${quizKey} could not be displayed due to data processing errors.
                            </p>
                        </div>
                    `;
                }
            }

            // Set the content
            container.innerHTML = htmlContent;

            // Add event listeners for search functionality
            const searchInput = container.querySelector('#question-search-input');
            const clearSearchBtn = container.querySelector('#clear-search-btn');
            const questionCards = container.querySelectorAll('.question-card');

            if (searchInput && clearSearchBtn) {
                // Function to filter questions based on search term
                const filterQuestions = (searchTerm) => {
                    const normalizedSearchTerm = searchTerm.toLowerCase().trim();
                    let visibleCount = 0;

                    questionCards.forEach(card => {
                        // Get the question text from the card (first h3 element)
                        const questionElement = card.querySelector('h3');
                        if (!questionElement) return;

                        // Get the text content of the question
                        const questionText = questionElement.textContent || '';

                        // Check if the question contains the search term
                        const isMatch = questionText.toLowerCase().includes(normalizedSearchTerm);

                        // Show or hide the card based on the match
                        card.style.display = isMatch || normalizedSearchTerm === '' ? '' : 'none';

                        // Count visible cards
                        if (isMatch || normalizedSearchTerm === '') {
                            visibleCount++;
                        }
                    });

                    // Show/hide clear button based on search input
                    clearSearchBtn.style.display = normalizedSearchTerm ? 'flex' : 'none';

                    // Show a message if no results found
                    const noResultsMsg = container.querySelector('#no-search-results');
                    if (normalizedSearchTerm && visibleCount === 0) {
                        if (!noResultsMsg) {
                            const msg = document.createElement('div');
                            msg.id = 'no-search-results';
                            msg.style.cssText = `
                                padding: 2rem;
                                text-align: center;
                                color: ${theme.text.secondary};
                                font-style: italic;
                                width: 100%;
                            `;
                            msg.textContent = `No questions found matching "${searchTerm}"`;
                            container.querySelector('.quiz-content-area').appendChild(msg);
                        }
                    } else if (noResultsMsg) {
                        noResultsMsg.remove();
                    }
                };

                // Add event listener for search input
                searchInput.addEventListener('input', (e) => {
                    filterQuestions(e.target.value);
                });

                // Add event listener for clear button
                clearSearchBtn.addEventListener('click', () => {
                    searchInput.value = '';
                    filterQuestions('');
                    searchInput.focus();
                });
            }

            // Add event listeners for quiz mode functionality
            const toggleBtn = container.querySelector('.toggle-mode-btn');
            const answerChoices = container.querySelectorAll('.answer-choice');

            // Function to check current mode
            function getCurrentMode() {
                return toggleBtn ? toggleBtn.getAttribute('data-mode') : 'quiz-answers';
            }

            // Function to apply quiz mode styling (hide colors)
            function applyQuizMode() {
                answerChoices.forEach(choice => {
                    const wasCorrect = choice.getAttribute('data-was-correct') === 'true';
                    const wasIncorrect = choice.getAttribute('data-was-incorrect') === 'true';

                    // Reset to neutral styling, add hover effect
                    choice.style.background = theme.status.neutral.bg;
                    choice.style.color = theme.status.neutral.text;
                    choice.style.border = `1px solid ${theme.status.neutral.border}`;
                    choice.style.cursor = 'pointer';

                    // Add hover effect
                    choice.addEventListener('mouseenter', function () {
                        if (!this.classList.contains('revealed')) {
                            this.style.background = theme.card.backgroundHover;
                        }
                    });
                    choice.addEventListener('mouseleave', function () {
                        if (!this.classList.contains('revealed')) {
                            this.style.background = theme.status.neutral.bg;
                        }
                    });

                    // Reset icon to neutral
                    const icon = choice.querySelector('.choice-icon');
                    if (icon) {
                        icon.innerHTML = LUCIDE_ICONS.circle;
                    }

                    // Remove revealed class
                    choice.classList.remove('revealed');
                });
            }

            // Function to apply normal mode styling (show colors)
            function applyNormalMode() {
                answerChoices.forEach(choice => {
                    const wasCorrect = choice.getAttribute('data-was-correct') === 'true';
                    const wasIncorrect = choice.getAttribute('data-was-incorrect') === 'true';

                    // Remove hover effects
                    choice.style.cursor = 'default';

                    // Apply appropriate styling based on correctness
                    if (wasCorrect) {
                        choice.style.background = theme.status.correct.bg;
                        choice.style.color = theme.status.correct.text;
                        choice.style.border = `1px solid ${theme.status.correct.border}`;
                        const icon = choice.querySelector('.choice-icon');
                        if (icon) icon.innerHTML = LUCIDE_ICONS.checkCircle;
                    } else if (wasIncorrect) {
                        choice.style.background = theme.status.incorrect.bg;
                        choice.style.color = theme.status.incorrect.text;
                        choice.style.border = `1px solid ${theme.status.incorrect.border}`;
                        const icon = choice.querySelector('.choice-icon');
                        if (icon) icon.innerHTML = LUCIDE_ICONS.xCircle;
                    } else {
                        choice.style.background = theme.status.neutral.bg;
                        choice.style.color = theme.status.neutral.text;
                        choice.style.border = `1px solid ${theme.status.neutral.border}`;
                        const icon = choice.querySelector('.choice-icon');
                        if (icon) icon.innerHTML = LUCIDE_ICONS.circle;
                    }

                    // Remove revealed class
                    choice.classList.remove('revealed');
                });
            }

            // Function to toggle between quiz and normal modes
            function toggleMode() {
                const currentMode = getCurrentMode();

                if (currentMode === 'quiz-answers') {
                    // Switch to quiz mode
                    applyQuizMode();
                    toggleBtn.innerHTML = `${LUCIDE_ICONS.checkCircle} Quiz Answers`;
                    toggleBtn.setAttribute('data-mode', 'quiz-type');
                } else {
                    // Switch to normal mode
                    applyNormalMode();
                    toggleBtn.innerHTML = `${LUCIDE_ICONS.circle} Quiz Type`;
                    toggleBtn.setAttribute('data-mode', 'quiz-answers');
                }
            }

            // Function to handle choice clicks in quiz mode
            function handleChoiceClick(choice) {
                const currentMode = getCurrentMode();
                if (currentMode !== 'quiz-type') return;

                const wasCorrect = choice.getAttribute('data-was-correct') === 'true';
                const wasIncorrect = choice.getAttribute('data-was-incorrect') === 'true';

                // Mark as revealed and apply appropriate styling
                choice.classList.add('revealed');

                if (wasCorrect) {
                    choice.style.background = theme.status.correct.bg;
                    choice.style.color = theme.status.correct.text;
                    choice.style.border = `1px solid ${theme.status.correct.border}`;
                    const icon = choice.querySelector('.choice-icon');
                    if (icon) icon.innerHTML = LUCIDE_ICONS.checkCircle;
                } else if (wasIncorrect) {
                    choice.style.background = theme.status.incorrect.bg;
                    choice.style.color = theme.status.incorrect.text;
                    choice.style.border = `1px solid ${theme.status.incorrect.border}`;
                    const icon = choice.querySelector('.choice-icon');
                    if (icon) icon.innerHTML = LUCIDE_ICONS.xCircle;
                }
            }

            // Add click handlers for answer choices in quiz mode
            answerChoices.forEach(choice => {
                choice.addEventListener('click', function (e) {
                    e.stopPropagation();
                    handleChoiceClick(this);
                });
            });

            // Add click handler for mode toggle button
            if (toggleBtn) {
                toggleBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    toggleMode();
                });
            }

            // Initialize in normal mode (Quiz Answers mode)
            applyNormalMode();

            // Add event listeners for export buttons
            const copyDropdown = container.querySelector('.copy-dropdown');
            const copyBtn = container.querySelector('.copy-questions-btn');
            const copyDropdownMenu = container.querySelector('.copy-dropdown-menu');
            const copyFormatBtns = container.querySelectorAll('.copy-format-btn');
            const copyHtmlBtn = container.querySelector('.copy-html-btn');

            // Toggle dropdown menu
            if (copyBtn && copyDropdownMenu) {
                copyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isVisible = copyDropdownMenu.style.display === 'block';
                    copyDropdownMenu.style.display = isVisible ? 'none' : 'block';
                });

                // Close dropdown when clicking outside
                document.addEventListener('click', (e) => {
                    if (copyDropdown && !copyDropdown.contains(e.target)) {
                        copyDropdownMenu.style.display = 'none';
                    }
                });

                // Add hover effect to dropdown items
                copyFormatBtns.forEach(btn => {
                    btn.addEventListener('mouseenter', () => {
                        btn.style.background = theme.button.backgroundHover;
                    });
                    btn.addEventListener('mouseleave', () => {
                        btn.style.background = 'transparent';
                    });
                });
            }

            // Handle format button clicks
            copyFormatBtns.forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const format = btn.getAttribute('data-format');
                    
                    // Close dropdown
                    if (copyDropdownMenu) {
                        copyDropdownMenu.style.display = 'none';
                    }
                    
                    // Update main button to show processing
                    const originalContent = copyBtn.innerHTML;
                    copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite; display: inline-block;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Processing...`;
                    
                    // Add spinner animation style if not already added
                    if (!document.querySelector('#spinner-style')) {
                        const style = document.createElement('style');
                        style.id = 'spinner-style';
                        style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
                        document.head.appendChild(style);
                    }
                    
                    try {
                        let textToCopy = '';
                        let htmlToCopy = null;
                        let successMessage = 'Copied!';
                        
                        switch (format) {
                            case 'rich':
                                // Rich text with HTML formatting
                                const richHtmlText = generateRichCopyText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers);
                                const plainText = generateCopyText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers);
                                htmlToCopy = await convertImagesToBase64(richHtmlText);
                                textToCopy = plainText;
                                successMessage = 'Copied with formatting!';
                                break;
                            case 'markdown':
                                // Markdown format
                                textToCopy = generateMarkdownText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers);
                                successMessage = 'Copied as Markdown!';
                                break;
                            case 'anki':
                                // Anki flashcard format (tab-separated)
                                textToCopy = generateAnkiText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers);
                                successMessage = 'Copied for Anki!';
                                break;
                            case 'quizlet':
                                // Quizlet format (tab-separated, question and correct answer only)
                                textToCopy = generateQuizletText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers);
                                successMessage = 'Copied for Quizlet!';
                                break;
                            default:
                                textToCopy = generateCopyText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers);
                        }
                        
                        // Copy to clipboard
                        if (htmlToCopy) {
                            const htmlBlob = new Blob([htmlToCopy], { type: "text/html" });
                            const textBlob = new Blob([textToCopy], { type: "text/plain" });
                            const data = [new ClipboardItem({
                                "text/html": htmlBlob,
                                "text/plain": textBlob
                            })];
                            await navigator.clipboard.write(data);
                        } else {
                            await navigator.clipboard.writeText(textToCopy);
                        }
                        
                        copyBtn.innerHTML = `${LUCIDE_ICONS.checkCircle} ${successMessage}`;
                        setTimeout(() => {
                            copyBtn.innerHTML = `${LUCIDE_ICONS.copy} Copy All ${LUCIDE_ICONS.chevronDown}`;
                        }, 2000);
                    } catch (err) {
                        console.error('Copy failed:', err);
                        copyBtn.innerHTML = `${LUCIDE_ICONS.xCircle} Copy failed`;
                        setTimeout(() => {
                            copyBtn.innerHTML = `${LUCIDE_ICONS.copy} Copy All ${LUCIDE_ICONS.chevronDown}`;
                        }, 2000);
                    }
                });
            });

            if (copyHtmlBtn) {
                copyHtmlBtn.addEventListener('click', async () => {
                    try {
                        // Update button to show processing with image and spinner icon
                        copyHtmlBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite; display: inline-block;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Processing images...`;

                        // Generate filename with course name and quiz title
                        const courseName = courseData.courseName || `Course ${currentCourseId}`;
                        let quizTitle = '';
                        
                        // Get quiz title from the first available quiz
                        if (quizKeysToShow.length > 0) {
                            const firstQuizKey = quizKeysToShow[0];
                            const firstQuiz = courseData[firstQuizKey];
                            if (firstQuiz && firstQuiz.quizTitle) {
                                quizTitle = firstQuiz.quizTitle;
                            } else if (firstQuiz && firstQuiz.quizId) {
                                quizTitle = `Quiz ${firstQuiz.quizId}`;
                            }
                        }

                        // Generate the full HTML report using the shared function
                        const fullHtml = await generateFullHtmlReport(container, {
                            courseName: courseName,
                            quizTitle: quizTitle,
                            includeSearch: true,
                            includeQuizMode: true
                        });

                        // Create a blob and download link
                        const blob = new Blob([fullHtml], { type: 'text/html' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        
                        // Sanitize filename (remove special characters)
                        const sanitize = (str) => str.replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '_').substring(0, 50);
                        const filename = quizTitle ? `${sanitize(courseName)}-${sanitize(quizTitle)}` : sanitize(courseName);

                        a.download = `${filename}.html`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);

                        // Update button to show success
                        copyHtmlBtn.innerHTML = `${LUCIDE_ICONS.checkCircle} Downloaded!`;
                        setTimeout(() => {
                            copyHtmlBtn.innerHTML = `${LUCIDE_ICONS.download} Download HTML`;
                        }, 2000);
                    } catch (error) {
                        console.error('Error downloading HTML:', error);
                        copyHtmlBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg> Error`;
                        setTimeout(() => {
                            copyHtmlBtn.innerHTML = `${LUCIDE_ICONS.download} Download HTML`;
                        }, 2000);
                    }
                });
            }

            // Trigger data sharing if on quiz results/submission page
            const isQuizSubmissionPage = (window.location.href.includes('/submissions/') && 
                !window.location.href.match(/\/submissions\?/)) || 
                (document.querySelector('.quiz-submission') !== null);
            
            if (isQuizSubmissionPage && quizKeysToShow.length > 0) {
                const firstQuizKey = quizKeysToShow[0];
                const quizInfo = courseData[firstQuizKey];
                const courseName = courseData.courseName || 'Unknown Course';
                const quizTitle = (quizInfo && quizInfo.quizTitle) || 'Quiz';
                
                // Call the sharing function (it handles consent checking internally)
                handleQuizResultsPageSharing(container, currentCourseId, firstQuizKey, courseName, quizTitle);
            }

        } catch (error) {
            console.error("Critical error rendering quiz content:", error);

            // Try to show partial content with error message
            try {
                const errorMessage = `
                    <div style="
                        background: #ffffff;
                        border: 1px solid #fecaca;
                        border-radius: 0.75rem;
                        padding: 2rem;
                        margin: 1rem 0;
                        text-align: center;
                        box-shadow: ${theme.card.shadow};
                    ">
                        <div style="
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            width: 3rem;
                            height: 3rem;
                            background: #fef2f2;
                            border-radius: 50%;
                            margin-bottom: 1rem;
                        ">
                            ${LUCIDE_ICONS.alertCircle}
                        </div>
                        <h3 style="
                            color: #dc2626;
                            font-size: 1.25rem;
                            font-weight: 600;
                            margin: 0 0 0.5rem 0;
                        ">Unable to Display Quiz Content</h3>
                        <p style="
                            color: #6b7280;
                            margin: 0 0 1rem 0;
                            line-height: 1.5;
                        ">There was an error processing the quiz data. This may be due to:</p>
                        <ul style="
                            color: #6b7280;
                            text-align: left;
                            max-width: 20rem;
                            margin: 0 auto 1.5rem auto;
                            line-height: 1.5;
                        ">
                            <li>Unsupported question formats</li>
                            <li>Corrupted stored data</li>
                            <li>Browser compatibility issues</li>
                        </ul>
                        <p style="
                            color: #6b7280;
                            font-size: 0.875rem;
                            margin: 0;
                        ">Try refreshing the page or clearing extension data if the problem persists.</p>
                    </div>
                `;

                // Check if we have any content already built before the error
                if (htmlContent && htmlContent.length > 100) {
                    // Show partial content with error message at the top
                    container.innerHTML = errorMessage + htmlContent;
                } else {
                    // Show just the error message
                    container.innerHTML = errorMessage;
                }

            } catch (fallbackError) {
                console.error("Error creating fallback content:", fallbackError);
                // Final fallback - simple error message
                container.innerHTML = `
                    <div style="
                        color: #dc2626; 
                        text-align: center; 
                        padding: 2rem;
                        background: #fef2f2;
                        border-radius: 0.5rem;
                        margin: 1rem;
                    ">
                        <strong>Error loading quiz content.</strong><br>
                        Please refresh the page and try again.
                    </div>
                `;
            }
        }
    }

    function fetchQuestionData() {
        try {
            // First, check if we have multiple questions on the page (quiz_sortable question_holder structure)
            const questionHolders = document.querySelectorAll('.quiz_sortable.question_holder');

            if (questionHolders && questionHolders.length > 0) {

                // Process each question holder separately
                questionHolders.forEach((holder, index) => {
                    let questionId = null;
                    try {
                        // Look for question ID in the holder's attributes or children
                        // Try to get question ID from data attributes
                        if (holder.hasAttribute('data-group-id')) {
                            questionId = holder.getAttribute('data-group-id');
                        }

                        // If no data-group-id, look for question elements within this holder
                        if (!questionId) {
                            const questionElement = holder.querySelector('.question');
                            if (questionElement && questionElement.id) {
                                questionId = questionElement.id.replace('question_', '');
                            }
                        }

                        // If still no ID, look for any element with an ID that contains 'question'
                        if (!questionId) {
                            const questionIdElement = holder.querySelector('[id*="question_"]');
                            if (questionIdElement) {
                                const idMatch = questionIdElement.id.match(/question_(\d+)/);
                                if (idMatch) {
                                    questionId = idMatch[1];
                                }
                            }
                        }

                        if (!questionId) {
                            throw new Error(`Could not find question ID for holder ${index}`);
                        }

                        // Get question text from within this holder
                        const questionTextElement = holder.querySelector('.question_text, .display_question .question_text');
                        if (!questionTextElement) {
                            throw new Error(`Could not find question text element for question ${questionId}`);
                        }

                        const questionText = questionTextElement.innerHTML.trim();
                        if (!questionText) {
                            throw new Error(`Question text is empty for question ${questionId}`);
                        }

                        // Detect question type from the question element's class
                        const questionElement = holder.querySelector('.question, .display_question');
                        let questionType = 'unknown';
                        if (questionElement) {
                            const classMatch = questionElement.className.match(
                                /(multiple_answers_question|multiple_choice_question|true_false_question|matching_question|short_answer_question|essay_question|fill_in_multiple_blanks_question|multiple_dropdowns_question|numerical_question)/
                            );
                            if (classMatch) {
                                questionType = classMatch[1];
                            }
                        }

                        // Get answer choices from within this holder
                        const answerChoices = {};
                        
                        // Store question type for proper handling during display
                        answerChoices["question_type"] = questionType;
                        // Try multiple selectors to find answer choices in different Canvas formats
                        let answerLabels = holder.querySelectorAll('.answer_label');
                        
                        // If no answer_label found, try quiz results page format first
                        // Results page has .answers_wrapper > .answer divs with .answer_text inside
                        if (answerLabels.length === 0) {
                            answerLabels = holder.querySelectorAll('.answers_wrapper > .answer, .answers > .answer');
                        }
                        
                        // If still not found, try other common selectors
                        if (answerLabels.length === 0) {
                            answerLabels = holder.querySelectorAll('.answer, .answer_choice, .answer_text, .choice, label[for*="answer"]');
                        }
                        
                        // If still no answers found, try looking for radio/checkbox inputs and their labels
                        if (answerLabels.length === 0) {
                            const inputs = holder.querySelectorAll('input[type="radio"], input[type="checkbox"]');
                            if (inputs.length > 0) {
                                // Create a NodeList-like array from the labels associated with these inputs
                                const labels = [];
                                inputs.forEach(input => {
                                    // Try to find the label for this input
                                    let label = null;
                                    if (input.id) {
                                        label = holder.querySelector(`label[for="${input.id}"]`);
                                    }
                                    if (!label) {
                                        label = input.closest('label');
                                    }
                                    if (!label) {
                                        label = input.parentElement;
                                    }
                                    if (label && !labels.includes(label)) {
                                        labels.push(label);
                                    }
                                });
                                answerLabels = labels;
                            }
                        }
                        
                        
                        if (answerLabels.length === 0) {
                        }

                        answerLabels.forEach(function (answer) {
                            try {
                                const skipChoiceId = answer.getAttribute('data-choice-id');
                                if (skipChoiceId === 'incorrect_answer' || skipChoiceId === 'correct_text_answer') return;

                                let choiceId = null;

                                // Try to get ID from hidden span.id element first (quiz results page format)
                                const hiddenIdSpan = answer.querySelector('span.hidden.id, span.id.hidden');
                                if (hiddenIdSpan) {
                                    choiceId = hiddenIdSpan.textContent.trim();
                                }

                                // Try different methods to extract choice ID from element ID
                                if (!choiceId && answer.id) {
                                    const idParts = answer.id.split("_");
                                    
                                    // Try various ID formats that Canvas might use:
                                    // Format R: Results page - answer_CHOICEID (simple 2-part format)
                                    // e.g., answer_33348
                                    if (idParts.length === 2 && idParts[0] === "answer" && /^\d+$/.test(idParts[1])) {
                                        choiceId = idParts[1];
                                    }
                                    // Format 0: question_QUESTIONID_answer_CHOICEID_label (all questions on one page format)
                                    // e.g., question_21771805_answer_33348_label
                                    else if (idParts.length >= 5 && idParts[0] === "question" && idParts[2] === "answer" && idParts[4] === "label") {
                                        choiceId = idParts[3];
                                    }
                                    // Format 1: answer_for_QUESTIONID_CHOICEID
                                    else if (idParts.length >= 4 && idParts[0] === "answer" && idParts[1] === "for") {
                                        choiceId = idParts[3];
                                    }
                                    // Format 2: answer_QUESTIONID_CHOICEID
                                    else if (idParts.length >= 3 && idParts[0] === "answer") {
                                        choiceId = idParts[2];
                                    }
                                    // Format 3: question_QUESTIONID_answer_CHOICEID (without _label suffix)
                                    else if (idParts.length >= 4 && idParts[0] === "question" && idParts[2] === "answer") {
                                        choiceId = idParts[3];
                                    }
                                    // Fallback: take last part if it's numeric
                                    else if (idParts.length >= 2) {
                                        const lastPart = idParts[idParts.length - 1];
                                        if (/^\d+$/.test(lastPart)) {
                                            choiceId = lastPart;
                                        }
                                    }
                                }

                                // If still no choice ID, try to find it from nearby input elements
                                if (!choiceId) {
                                    const input = answer.querySelector('input[type="radio"], input[type="checkbox"], input[name*="answer"]');
                                    if (input) {
                                        // Try to extract from input name
                                        if (input.name) {
                                            const nameMatch = input.name.match(/answer_(\d+)/);
                                            if (nameMatch) {
                                                choiceId = nameMatch[1];
                                            }
                                        }
                                        // Try to extract from input value or id
                                        if (!choiceId && input.value && /^\d+$/.test(input.value)) {
                                            choiceId = input.value;
                                        }
                                        if (!choiceId && input.id) {
                                            const inputIdMatch = input.id.match(/(\d+)$/);
                                            if (inputIdMatch) {
                                                choiceId = inputIdMatch[1];
                                            }
                                        }
                                    }
                                }

                                // If still no choice ID, try data attributes
                                if (!choiceId) {
                                    if (answer.dataset.answerId) {
                                        choiceId = answer.dataset.answerId;
                                    } else if (answer.getAttribute('data-answer-id')) {
                                        choiceId = answer.getAttribute('data-answer-id');
                                    }
                                }

                                // If we still don't have a choice ID, generate one based on the position
                                if (!choiceId) {
                                    const allAnswersInHolder = Array.from(holder.querySelectorAll('.answer_label'));
                                    const answerIndex = allAnswersInHolder.indexOf(answer);
                                    if (answerIndex >= 0) {
                                        choiceId = `choice_${questionId}_${answerIndex}`;
                                    }
                                }

                                // Try to get text from .answer_text first (quiz results page format)
                                // This extracts clean answer text without surrounding HTML from labels/inputs
                                const answerTextElement = answer.querySelector('.answer_text');
                                let choiceContent, choiceText;
                                
                                if (answerTextElement) {
                                    // Results page format - extract from .answer_text div
                                    choiceContent = answerTextElement.innerHTML.trim();
                                    choiceText = answerTextElement.textContent.trim();
                                } else {
                                    // Fallback: strip Canvas results-page injections before capturing
                                    const cleanEl = cleanAnswerElement(answer);
                                    choiceContent = cleanEl.innerHTML.trim();
                                    choiceText = cleanEl.textContent.trim();
                                }

                                if (choiceId && (choiceContent || choiceText)) {
                                    // Store the full HTML content, fallback to text if no HTML
                                    answerChoices[choiceId] = choiceContent || choiceText;
                                    
                                    // Detect if this is a correct answer (quiz results page)
                                    // Check for correct_answer class or answer_weight of 100
                                    const answerWeightSpan = answer.querySelector('.answer_weight');
                                    const isCorrectAnswer = answer.classList.contains('correct_answer') ||
                                        (answerWeightSpan && answerWeightSpan.textContent.trim() === '100');
                                    
                                    if (isCorrectAnswer) {
                                        if (!answerChoices["correct_answers"]) {
                                            answerChoices["correct_answers"] = [];
                                        }
                                        answerChoices["correct_answers"].push(choiceId);
                                    }
                                } else {
                                }
                            } catch (error) {
                                console.error("Error processing answer choice in holder:", error, answer);
                            }
                        });

                        // Check for matching questions (dropdowns with select elements)
                        // Count actual answer choices (exclude metadata keys like question_type, correct_answers)
                        const metadataKeys = ['question_type', 'correct_answers', 'matching_pairs', 'text_answer'];
                        const actualChoiceCount = Object.keys(answerChoices).filter(k => !metadataKeys.includes(k)).length;
                        
                        const matchingSelects = holder.querySelectorAll('select.question_input');
                        if (matchingSelects && matchingSelects.length > 0 && actualChoiceCount === 0) {
                            
                            // Store the matching pairs
                            const matchingPairs = [];
                            matchingSelects.forEach(select => {
                                // Get the term/label for this select - try multiple strategies
                                let label = null;
                                let term = 'Unknown term';
                                
                                // Strategy 1: Label in previous sibling div (quiz results page format)
                                // Structure: <div class="answer"><div class="pull-left"><label>...</label></div><div class="pull-left"><select>...</select></div></div>
                                const parentDiv = select.parentElement;
                                if (parentDiv && parentDiv.previousElementSibling) {
                                    label = parentDiv.previousElementSibling.querySelector('label');
                                }
                                
                                // Strategy 2: Label is a direct sibling or in parent's previous sibling
                                if (!label && select.parentElement?.previousElementSibling) {
                                    label = select.parentElement.previousElementSibling.querySelector('label') || 
                                            select.parentElement.previousElementSibling;
                                    if (label && label.tagName !== 'LABEL') {
                                        label = null;
                                    }
                                }
                                
                                // Strategy 3: Find label by 'for' attribute matching select id
                                if (!label && select.id) {
                                    label = holder.querySelector(`label[for="${select.id}"]`);
                                }
                                
                                // Strategy 4: Look in the closest .answer container
                                if (!label) {
                                    const answerContainer = select.closest('.answer');
                                    if (answerContainer) {
                                        label = answerContainer.querySelector('label');
                                    }
                                }
                                
                                if (label) {
                                    term = label.textContent.trim();
                                }
                                
                                // Get the selected option
                                const selectedOption = select.options[select.selectedIndex];
                                const selectedValue = selectedOption ? selectedOption.value : '';
                                const selectedText = selectedOption ? selectedOption.textContent.trim() : '';
                                
                                // Get all available options (excluding the placeholder)
                                const allOptions = [];
                                for (let i = 0; i < select.options.length; i++) {
                                    const option = select.options[i];
                                    if (option.value !== '') { // Skip "[ Choose ]" placeholder
                                        allOptions.push({
                                            value: option.value,
                                            text: option.textContent.trim()
                                        });
                                    }
                                }
                                
                                matchingPairs.push({
                                    term: term,
                                    selectedValue: selectedValue,
                                    selectedText: selectedText,
                                    selectName: select.name,
                                    allOptions: allOptions
                                });
                                
                            });
                            
                            answerChoices["matching_pairs"] = matchingPairs;
                            answerChoices["question_type"] = "matching";
                        }

                        // Check for text input fields within this holder
                        // Recalculate actual choice count after matching question processing
                        const actualChoiceCountAfterMatching = Object.keys(answerChoices).filter(k => !metadataKeys.includes(k)).length;
                        const textInput = holder.querySelector(`.question_input[name="question_${questionId}"]`);
                        if (textInput && actualChoiceCountAfterMatching === 0) {
                            const userAnswer = textInput.value.trim();
                            if (userAnswer) {
                                answerChoices["text_answer"] = userAnswer;
                            }
                            answerChoices["question_type"] = "identification";
                        }

                        // Store the successful data for this question
                        storeData(questionId, questionText, answerChoices, false); // false = not an error

                        
                        // Log detailed debug info if no choices were found
                        if (Object.keys(answerChoices).length === 0) {
                        }

                    } catch (error) {
                        console.error(`Error processing question holder ${index}:`, error);
                        // Store error information for this question
                        if (questionId) {
                            storeData(questionId, null, null, true, `Error processing question: ${error.message}`);
                        } else {
                            // If we couldn't even get the question ID, create a placeholder
                            const placeholderQuestionId = `error_holder_${index}_${Date.now()}`;
                            storeData(placeholderQuestionId, null, null, true, `Error processing question holder ${index}: ${error.message}`);
                        }
                    }
                });

                return; // Exit early since we processed multiple questions
            }

            // Fallback to original single question processing if no question holders found

            let questionId = null;
            try {
                // Get the current question information (original code for single question pages)
                var questionText = document.querySelector('.question_text');
                var questionElement = document.querySelector('.question');

                if (!questionText || !questionElement) {
                    throw new Error("Question elements not found on page");
                }

                var questionData = questionText.innerHTML.trim();
                questionId = questionElement.getAttribute('id');

                if (!questionData) {
                    throw new Error("Question text is empty");
                }

                if (!questionId) {
                    throw new Error("Question ID not found");
                }

                // Convert questionId to just the number
                var numericQuestionId = questionId.replace('question_', '');

                // Detect question type from the question element's class
                var questionType = 'unknown';
                if (questionElement) {
                    var classMatch = questionElement.className.match(
                        /(multiple_answers_question|multiple_choice_question|true_false_question|matching_question|short_answer_question|essay_question|fill_in_multiple_blanks_question|multiple_dropdowns_question|numerical_question)/
                    );
                    if (classMatch) {
                        questionType = classMatch[1];
                    }
                }

                // Get all answer choices - try multiple selectors
                var answerChoices = {};
                
                // Store question type for proper handling during display
                answerChoices["question_type"] = questionType;
                
                var answerElements = document.querySelectorAll('.answer_label');
                
                // If no answer_label found, try results page format
                if (answerElements.length === 0) {
                    answerElements = document.querySelectorAll('.answers_wrapper > .answer, .answers > .answer');
                }
                
                answerElements.forEach(function (answer) {
                    try {
                        var skipChoiceId = answer.getAttribute('data-choice-id');
                        if (skipChoiceId === 'incorrect_answer' || skipChoiceId === 'correct_text_answer') return;

                        var choiceId = null;

                        // Try to get ID from hidden span first (results page format)
                        var hiddenIdSpan = answer.querySelector('span.hidden.id, span.id.hidden');
                        if (hiddenIdSpan) {
                            choiceId = hiddenIdSpan.textContent.trim();
                        }
                        
                        // Try element ID formats
                        if (!choiceId && answer.id) {
                            var idParts = answer.id.split("_");
                            
                            // Results page: answer_CHOICEID (simple 2-part format)
                            if (idParts.length === 2 && idParts[0] === "answer" && /^\d+$/.test(idParts[1])) {
                                choiceId = idParts[1];
                            }
                            // Quiz taking page: question_X_answer_Y_label format
                            else if (idParts.length >= 5 && idParts[0] === "question" && idParts[2] === "answer" && idParts[4] === "label") {
                                choiceId = idParts[3];
                            }
                            // Format: answer_for_QUESTIONID_CHOICEID
                            else if (idParts.length >= 4 && idParts[0] === "answer" && idParts[1] === "for") {
                                choiceId = idParts[3];
                            }
                            // Format: answer_QUESTIONID_CHOICEID
                            else if (idParts.length >= 3 && idParts[0] === "answer") {
                                choiceId = idParts[2];
                            }
                            // Format: question_QUESTIONID_answer_CHOICEID (without _label suffix)
                            else if (idParts.length >= 4 && idParts[0] === "question" && idParts[2] === "answer") {
                                choiceId = idParts[3];
                            }
                            // Fallback: other formats
                            else if (idParts.length >= 4) {
                                choiceId = idParts[3];
                            }
                        }
                        
                        // Try to get text from .answer_text first (results page format)
                        var answerTextElement = answer.querySelector('.answer_text');
                        var choiceContent, choiceText;
                        
                        if (answerTextElement) {
                            choiceContent = answerTextElement.innerHTML.trim();
                            choiceText = answerTextElement.textContent.trim();
                        } else {
                            // Fallback: strip Canvas results-page injections before capturing
                            var cleanEl = cleanAnswerElement(answer);
                            choiceContent = cleanEl.innerHTML.trim();
                            choiceText = cleanEl.textContent.trim();
                        }
                        
                        if (choiceId && (choiceContent || choiceText)) {
                            answerChoices[choiceId] = choiceContent || choiceText;
                            
                            // Detect if this is a correct answer (quiz results page)
                            var answerWeightSpan = answer.querySelector('.answer_weight');
                            var isCorrectAnswer = answer.classList.contains('correct_answer') ||
                                (answerWeightSpan && answerWeightSpan.textContent.trim() === '100');
                            
                            if (isCorrectAnswer) {
                                if (!answerChoices["correct_answers"]) {
                                    answerChoices["correct_answers"] = [];
                                }
                                answerChoices["correct_answers"].push(choiceId);
                            }
                        }
                    } catch (error) {
                        console.error("Error processing answer choice:", error);
                    }
                });

                // Check for matching questions (dropdowns with select elements)
                // Count actual answer choices (exclude metadata keys like question_type, correct_answers)
                var metadataKeys = ['question_type', 'correct_answers', 'matching_pairs', 'text_answer'];
                var actualChoiceCount = Object.keys(answerChoices).filter(function(k) { return metadataKeys.indexOf(k) === -1; }).length;
                
                var matchingSelects = document.querySelectorAll('select.question_input');
                if (matchingSelects && matchingSelects.length > 0 && actualChoiceCount === 0) {
                    
                    // Store the matching pairs
                    var matchingPairs = [];
                    matchingSelects.forEach(function(select) {
                        // Get the term/label for this select - try multiple strategies
                        var label = null;
                        var term = 'Unknown term';
                        
                        // Strategy 1: Label in previous sibling div (quiz results page format)
                        // Structure: <div class="answer"><div class="pull-left"><label>...</label></div><div class="pull-left"><select>...</select></div></div>
                        var parentDiv = select.parentElement;
                        if (parentDiv && parentDiv.previousElementSibling) {
                            label = parentDiv.previousElementSibling.querySelector('label');
                        }
                        
                        // Strategy 2: Find label by 'for' attribute matching select id
                        if (!label && select.id) {
                            label = document.querySelector('label[for="' + select.id + '"]');
                        }
                        
                        // Strategy 3: Look in the closest .answer container
                        if (!label) {
                            var answerContainer = select.closest('.answer');
                            if (answerContainer) {
                                label = answerContainer.querySelector('label');
                            }
                        }
                        
                        if (label) {
                            term = label.textContent.trim();
                        }
                        
                        // Get the selected option
                        var selectedOption = select.options[select.selectedIndex];
                        var selectedValue = selectedOption ? selectedOption.value : '';
                        var selectedText = selectedOption ? selectedOption.textContent.trim() : '';
                        
                        // Get all available options (excluding the placeholder)
                        var allOptions = [];
                        for (var i = 0; i < select.options.length; i++) {
                            var option = select.options[i];
                            if (option.value !== '') { // Skip "[ Choose ]" placeholder
                                allOptions.push({
                                    value: option.value,
                                    text: option.textContent.trim()
                                });
                            }
                        }
                        
                        matchingPairs.push({
                            term: term,
                            selectedValue: selectedValue,
                            selectedText: selectedText,
                            selectName: select.name,
                            allOptions: allOptions
                        });
                        
                    });
                    
                    answerChoices["matching_pairs"] = matchingPairs;
                    answerChoices["question_type"] = "matching";
                }

                // Check for text input fields (used in fill-in-the-blank/identification questions)
                // Recalculate actual choice count after matching question processing
                actualChoiceCount = Object.keys(answerChoices).filter(function(k) { return metadataKeys.indexOf(k) === -1; }).length;
                var textInput = document.querySelector('.question_input[name="question_' + numericQuestionId + '"]');
                if (textInput && actualChoiceCount === 0) {
                    // For text input questions, store the current value as a special type
                    var userAnswer = textInput.value.trim();
                    if (userAnswer) {
                        // Store the user's answer with a special key
                        answerChoices["text_answer"] = userAnswer;
                    }

                    // Mark this as a text/identification question type
                    answerChoices["question_type"] = "identification";
                }

                // Store the successful data locally
                storeData(numericQuestionId, questionData, answerChoices, false); // false = not an error


            } catch (error) {
                console.error("Error fetching single question data:", error);
                // Store error information for this question
                if (questionId) {
                    const numericQuestionId = questionId.replace('question_', '');
                    storeData(numericQuestionId, null, null, true, `Error fetching question: ${error.message}`);
                } else {
                    // If we couldn't even get the question ID, create a placeholder
                    const placeholderQuestionId = `error_single_${Date.now()}`;
                    storeData(placeholderQuestionId, null, null, true, `Error fetching question data: ${error.message}`);
                }
            }
        } catch (error) {
            console.error("Critical error in fetchQuestionData:", error);
            // Store a general error if everything fails
            const placeholderQuestionId = `error_critical_${Date.now()}`;
            storeData(placeholderQuestionId, null, null, true, `Critical error during question fetching: ${error.message}`);
        }
    }

    function storeData(questionId, question, choices, isError = false, errorMessage = null) {
        try {
            // Get existing stored questions or initialize as empty object
            const storedData = safeLocalStorageGet('quizQuestions');
            const storedQuestions = storedData ? JSON.parse(storedData) : {};

            // Create new data for this question
            const link = window.location.href;

            // Safely extract course, quiz, and assignment IDs
            let courseId, quizId, assignmentId;
            try {
                courseId = parseInt(link.split("courses/")[1].split("/")[0]);

                // Extract quiz ID from URL
                if (link.includes("quizzes/")) {
                    quizId = parseInt(link.split("quizzes/")[1].split("/")[0]);
                }

                // Extract assignment ID from URL if available
                if (link.includes("assignments/")) {
                    assignmentId = parseInt(link.split("assignments/")[1].split("/")[0]);
                }

                // Get assignment ID from page if available
                if (!assignmentId) {
                    const assignmentIdMeta = document.querySelector('meta[name="assignment_id"]');
                    if (assignmentIdMeta) {
                        assignmentId = parseInt(assignmentIdMeta.content);
                    }
                }

                // If we still don't have the assignment ID, try to find it in the DOM
                if (!assignmentId) {
                    const assignmentIdElement = document.querySelector('[data-assignment-id]');
                    if (assignmentIdElement) {
                        assignmentId = parseInt(assignmentIdElement.getAttribute('data-assignment-id'));
                    }
                }
            } catch (error) {
                console.error("Error parsing course/quiz/assignment IDs from URL:", error);
                courseId = "unknown";
                quizId = "unknown";
                assignmentId = "unknown";
            }

            // Make sure the structure exists
            if (!storedQuestions[courseId]) {
                storedQuestions[courseId] = {
                    courseName: null // Will be populated when available
                };
            }

            // Update course name if not set and we can extract it
            if (!storedQuestions[courseId].courseName) {
                const courseName = extractCourseName();
                if (courseName) {
                    storedQuestions[courseId].courseName = courseName;
                }
            }

            // Use a composite key for the quiz that includes both quiz ID and assignment ID if available
            const quizKey = assignmentId ? `${quizId}_${assignmentId}` : quizId;

            const currentTimestamp = new Date().toISOString();

            if (!storedQuestions[courseId][quizKey]) {
                // Extract quiz title when creating new quiz entry
                const quizTitle = extractQuizTitle();
                
                storedQuestions[courseId][quizKey] = {
                    quizId: quizId,
                    assignmentId: assignmentId,
                    quizTitle: quizTitle || null,
                    firstCapturedAt: currentTimestamp,
                    lastUpdatedAt: currentTimestamp,
                    questions: []
                };
            } else {
                // Update lastUpdatedAt timestamp on every question store
                storedQuestions[courseId][quizKey].lastUpdatedAt = currentTimestamp;
                
                // Try to update quiz title if not set
                if (!storedQuestions[courseId][quizKey].quizTitle) {
                    const quizTitle = extractQuizTitle();
                    if (quizTitle) {
                        storedQuestions[courseId][quizKey].quizTitle = quizTitle;
                    }
                }
            }

            // Create the question data - different structure for errors vs successful questions
            let questionData;
            if (isError) {
                questionData = {
                    questionId: questionId,
                    isError: true,
                    errorMessage: errorMessage,
                    timestamp: new Date().toISOString(),
                    // Keep placeholder data for consistency
                    question: null,
                    choices: null
                };
            } else {
                questionData = {
                    questionId: questionId,
                    question: question,
                    choices: choices,
                    isError: false
                };
            }

            // Check if this question already exists by ID
            const existingIndex = storedQuestions[courseId][quizKey].questions.findIndex(q =>
                q.questionId === questionId
            );

            let isNewQuestion = false;
            if (existingIndex >= 0) {
                // Update existing question (this allows replacing an error with successful data or vice versa)
                storedQuestions[courseId][quizKey].questions[existingIndex] = questionData;
                if (isError) {
                } else {
                }
            } else {
                // Add new question
                storedQuestions[courseId][quizKey].questions.push(questionData);
                if (isError) {
                } else {
                }
                isNewQuestion = true;
            }

            // Save data back to localStorage
            const success = safeLocalStorageSet('quizQuestions', JSON.stringify(storedQuestions));
            if (success) {
                if (isError) {
                } else {

                    // Record question capture interaction only for new successful questions
                    if (isNewQuestion) {
                        recordUserInteraction('question_captured', {
                            courseId: courseId.toString(),
                            quizId: quizId?.toString(),
                            assignmentId: assignmentId?.toString()
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Error storing data:", error);
        }
    }

    function retrieveData() {
        try {
            const storedData = safeLocalStorageGet('quizQuestions');
            const parsedData = storedData ? JSON.parse(storedData) : {};

            // Update total questions count whenever data is retrieved
            updateTotalQuestionsCount();

            return parsedData;
        } catch (error) {
            console.error("Error retrieving data:", error);
            return {};
        }
    }

    // Save correct and incorrect answers from submission API to storage
    function saveCorrectAnswersToStorage(courseId, quizKey, userAnswers, correctAnswers, incorrectAnswers) {
        try {
            const storedData = safeLocalStorageGet('quizQuestions');
            if (!storedData) return;

            const questionsData = JSON.parse(storedData);
            
            if (!questionsData[courseId] || !questionsData[courseId][quizKey]) {
                return;
            }

            const quiz = questionsData[courseId][quizKey];
            if (!quiz.questions || quiz.questions.length === 0) return;

            let updatedCount = 0;

            // Update each question with correct and incorrect answer information
            quiz.questions.forEach(question => {
                if (question.isError || !question.choices) return;

                const questionId = question.questionId;
                
                // Initialize arrays if not exists
                if (!question.choices.correct_answers) {
                    question.choices.correct_answers = [];
                }
                if (!question.choices.incorrect_answers) {
                    question.choices.incorrect_answers = [];
                }

                // Save correct answers
                if (correctAnswers[questionId] === true && userAnswers[questionId]) {
                    const answerIds = userAnswers[questionId];
                    if (Array.isArray(answerIds)) {
                        answerIds.forEach(answerId => {
                            // Handle text answers
                            if (typeof answerId === 'object' && answerId.type === 'text' && answerId.isCorrect) {
                                question.choices.correct_text_answer = answerId.value;
                            } else if (typeof answerId !== 'object' &&
                                       !question.choices.correct_answers.includes(answerId) && 
                                       !question.choices.correct_answers.includes(String(answerId))) {
                                question.choices.correct_answers.push(String(answerId));
                            }
                        });
                    }
                    updatedCount++;
                }

                // Save incorrect answers
                if (incorrectAnswers && incorrectAnswers[questionId] && Array.isArray(incorrectAnswers[questionId])) {
                    incorrectAnswers[questionId].forEach(answerId => {
                        // Handle text answers
                        if (typeof answerId === 'object' && answerId.type === 'text') {
                            if (!question.choices.incorrect_text_answers) {
                                question.choices.incorrect_text_answers = [];
                            }
                            if (!question.choices.incorrect_text_answers.includes(answerId.value)) {
                                question.choices.incorrect_text_answers.push(answerId.value);
                            }
                        } else if (typeof answerId !== 'object' &&
                                   !question.choices.incorrect_answers.includes(answerId) && 
                                   !question.choices.incorrect_answers.includes(String(answerId))) {
                            question.choices.incorrect_answers.push(String(answerId));
                        }
                    });
                    updatedCount++;
                }

                // Handle matching questions - mark the overall question correctness
                if (question.choices.matching_pairs && Array.isArray(question.choices.matching_pairs)) {
                    const isQuestionCorrect = correctAnswers[questionId] === true;
                    const isQuestionIncorrect = correctAnswers[questionId] === false;
                    
                    // Mark the matching pairs with the overall correctness
                    // Note: Canvas API doesn't give per-pair correctness, only overall
                    if (isQuestionCorrect || isQuestionIncorrect) {
                        question.choices.matching_pairs.forEach(pair => {
                            if (pair.selectedText && pair.selectedText.trim() !== '' && pair.selectedText !== '[ Choose ]') {
                                pair.isCorrect = isQuestionCorrect;
                            }
                        });
                        updatedCount++;
                    }
                }
            });

            if (updatedCount > 0) {
                // Update lastUpdatedAt
                quiz.lastUpdatedAt = new Date().toISOString();
                
                // Save back to storage
                safeLocalStorageSet('quizQuestions', JSON.stringify(questionsData));
            }
        } catch (error) {
            console.error('Error saving answers to storage:', error);
        }
    }

    // ============== QUIZ HISTORY FUNCTIONS ==============

    // Get aggregated quiz history data from all courses
    function getQuizHistoryData() {
        try {
            const allData = retrieveData();
            const historyItems = [];

            for (const courseId in allData) {
                if (!allData.hasOwnProperty(courseId)) continue;
                
                const courseData = allData[courseId];
                const courseName = courseData.courseName || `Course ${courseId}`;

                for (const quizKey in courseData) {
                    if (!courseData.hasOwnProperty(quizKey) || quizKey === 'courseName') continue;
                    
                    const quiz = courseData[quizKey];
                    if (!quiz || !quiz.questions) continue;

                    // Count non-error questions
                    const questionCount = quiz.questions.filter(q => !q.isError).length;
                    
                    historyItems.push({
                        courseId: courseId,
                        courseName: courseName,
                        quizKey: quizKey,
                        quizId: quiz.quizId,
                        assignmentId: quiz.assignmentId,
                        quizTitle: quiz.quizTitle || `Quiz ${quiz.quizId}`,
                        questionCount: questionCount,
                        firstCapturedAt: quiz.firstCapturedAt || null,
                        lastUpdatedAt: quiz.lastUpdatedAt || null,
                        questions: quiz.questions
                    });
                }
            }

            return historyItems;
        } catch (error) {
            console.error('Error getting quiz history data:', error);
            return [];
        }
    }

    // Sort quizzes by date
    function sortQuizzesByDate(quizzes, order = 'desc') {
        return quizzes.sort((a, b) => {
            const dateA = a.lastUpdatedAt ? new Date(a.lastUpdatedAt) : new Date(0);
            const dateB = b.lastUpdatedAt ? new Date(b.lastUpdatedAt) : new Date(0);
            return order === 'desc' ? dateB - dateA : dateA - dateB;
        });
    }

    // Sort quizzes by question count
    function sortQuizzesByQuestionCount(quizzes, order = 'desc') {
        return quizzes.sort((a, b) => {
            return order === 'desc' ? b.questionCount - a.questionCount : a.questionCount - b.questionCount;
        });
    }

    // Sort quizzes by course name
    function sortQuizzesByCourseName(quizzes) {
        return quizzes.sort((a, b) => {
            return a.courseName.localeCompare(b.courseName);
        });
    }

    // Format date for display
    function formatHistoryDate(isoString) {
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
                return `${diffDays} days ago`;
            } else {
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }
        } catch (error) {
            return 'Unknown';
        }
    }

    // Group quizzes by course
    function groupQuizzesByCourse(quizzes) {
        const grouped = {};
        quizzes.forEach(quiz => {
            if (!grouped[quiz.courseId]) {
                grouped[quiz.courseId] = {
                    courseName: quiz.courseName,
                    quizzes: []
                };
            }
            grouped[quiz.courseId].quizzes.push(quiz);
        });
        return grouped;
    }

    // Render the history view in a container
    function renderHistoryView(container, viewMode = 'all', currentCourseId = null, sortBy = 'recent', theme = null) {
        try {
            // Use default theme if not provided
            if (!theme) {
                theme = THEMES.light;
            }
            
            let historyData = getQuizHistoryData();
            
            // Filter by course if in course-specific mode
            if (viewMode === 'course' && currentCourseId) {
                historyData = historyData.filter(quiz => quiz.courseId == currentCourseId);
            }

            // Sort the data
            switch (sortBy) {
                case 'recent':
                    historyData = sortQuizzesByDate(historyData, 'desc');
                    break;
                case 'oldest':
                    historyData = sortQuizzesByDate(historyData, 'asc');
                    break;
                case 'questions':
                    historyData = sortQuizzesByQuestionCount(historyData, 'desc');
                    break;
                case 'course':
                    historyData = sortQuizzesByCourseName(historyData);
                    break;
                default:
                    historyData = sortQuizzesByDate(historyData, 'desc');
            }

            // Build the HTML
            let html = '';

            // Controls section
            html += `
                <div class="history-controls" style="
                    display: flex;
                    gap: 1rem;
                    margin-bottom: 1rem;
                    flex-wrap: wrap;
                    align-items: center;
                ">
                    <div style="display: flex; gap: 0.5rem; align-items: baseline;">
                        <label style="font-size: 0.875rem; color: ${theme.text.secondary}; font-weight: 500;">View:</label>
                        <select id="history-view-toggle" style="
                            padding: 0.375rem 0.75rem;
                            border: 1px solid ${theme.input.border};
                            border-radius: 0.375rem;
                            font-size: 0.875rem;
                            height: 2.25rem;
                            background: ${theme.input.background};
                            color: ${theme.input.text};
                            cursor: pointer;
                            min-width: 8rem;
                        ">
                            <option value="all" ${viewMode === 'all' ? 'selected' : ''}>All Courses</option>
                            <option value="course" ${viewMode === 'course' ? 'selected' : ''}>This Course</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: baseline;">
                        <label style="font-size: 0.875rem; color: ${theme.text.secondary}; font-weight: 500;">Sort:</label>
                        <select id="history-sort-toggle" style="
                            padding: 0.375rem 0.75rem;
                            border: 1px solid ${theme.input.border};
                            border-radius: 0.375rem;
                            font-size: 0.875rem;
                            height: 2.25rem;
                            background: ${theme.input.background};
                            color: ${theme.input.text};
                            cursor: pointer;
                            min-width: 8rem;
                        ">
                            <option value="recent" ${sortBy === 'recent' ? 'selected' : ''}>Most Recent</option>
                            <option value="oldest" ${sortBy === 'oldest' ? 'selected' : ''}>Oldest First</option>
                            <option value="questions" ${sortBy === 'questions' ? 'selected' : ''}>Most Questions</option>
                            <option value="course" ${sortBy === 'course' ? 'selected' : ''}>By Course</option>
                        </select>
                    </div>
                    <div style="margin-left: auto; font-size: 0.875rem; color: ${theme.text.secondary};">
                        ${historyData.length} quiz${historyData.length !== 1 ? 'zes' : ''}
                    </div>
                </div>
            `;

            if (historyData.length === 0) {
                html += `
                    <div style="
                        text-align: center;
                        padding: 2.5rem 1.25rem;
                        color: ${theme.text.secondary};
                    ">
                        <p>No quiz history found${viewMode === 'course' ? ' for this course' : ''}.</p>
                        <p style="font-size: 0.875rem; margin-top: 0.5rem;">Take some quizzes to start building your history!</p>
                    </div>
                `;
            } else {
                // Group by course for display
                const groupedData = groupQuizzesByCourse(historyData);
                
                html += '<div class="history-list" style="display: flex; flex-direction: column; gap: 0.75rem;">';
                
                for (const courseId in groupedData) {
                    const courseGroup = groupedData[courseId];
                    
                    html += `
                        <div class="history-course-group" data-course-id="${courseId}" style="
                            margin-bottom: 0.75rem;
                        ">
                            <div class="history-course-header" style="
                                padding: 0.75rem 1rem;
                                margin: 0 0.25rem;
                                background: ${theme.card.background};
                                border: 1px solid ${theme.card.border};
                                border-radius: 0.5rem;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                gap: 0.5rem;
                                font-weight: 500;
                                color: ${theme.text.primary};
                                box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                                transition: background 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1);
                            ">
                                <span class="history-expand-icon" style="transition: transform 0.2s;">▸</span>
                                <span>${courseGroup.courseName}</span>
                                <span style="
                                    margin-left: auto;
                                    font-size: 0.75rem;
                                    color: ${theme.text.secondary};
                                    font-weight: normal;
                                ">${courseGroup.quizzes.length} quiz${courseGroup.quizzes.length !== 1 ? 'zes' : ''}</span>
                            </div>
                            <div class="history-course-quizzes" style="display: none; margin-top: 0.25rem;">
                    `;
                    
                    courseGroup.quizzes.forEach(quiz => {
                        html += `
                            <div class="history-quiz-item" data-quiz-key="${quiz.quizKey}" data-course-id="${courseId}" style="
                                padding: 0.75rem 1rem 0.75rem 2.25rem;
                                margin: 0.25rem 0.75rem;
                                background: ${theme.card.background};
                                border: 1px solid ${theme.card.border};
                                border-radius: 0.5rem;
                                display: flex;
                                align-items: center;
                                gap: 1rem;
                                cursor: pointer;
                                transition: background 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1);
                                box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                            ">
                                <div style="flex: 1; min-width: 0;">
                                    <div style="
                                        font-weight: 500;
                                        color: ${theme.text.primary};
                                        white-space: nowrap;
                                        overflow: hidden;
                                        text-overflow: ellipsis;
                                    ">${quiz.quizTitle}</div>
                                </div>
                                <div style="
                                    font-size: 0.875rem;
                                    color: ${theme.text.secondary};
                                    white-space: nowrap;
                                ">${quiz.questionCount} Q${quiz.questionCount !== 1 ? 's' : ''}</div>
                                <div style="
                                    font-size: 0.875rem;
                                    color: ${theme.text.secondary};
                                    white-space: nowrap;
                                ">${formatHistoryDate(quiz.lastUpdatedAt)}</div>
                            </div>
                        `;
                    });
                    
                    html += `
                            </div>
                        </div>
                    `;
                }
                
                html += '</div>';
            }

            container.innerHTML = html;

            // Add event listeners for controls
            const viewToggle = container.querySelector('#history-view-toggle');
            const sortToggle = container.querySelector('#history-sort-toggle');

            if (viewToggle) {
                viewToggle.addEventListener('change', (e) => {
                    renderHistoryView(container, e.target.value, currentCourseId, sortToggle?.value || 'recent', theme);
                });
            }

            if (sortToggle) {
                sortToggle.addEventListener('change', (e) => {
                    renderHistoryView(container, viewToggle?.value || 'all', currentCourseId, e.target.value, theme);
                });
            }

            // Add event listeners for course group expansion
            container.querySelectorAll('.history-course-header').forEach(header => {
                // Add hover effects for course headers
                header.addEventListener('mouseenter', () => {
                    header.style.background = theme.card.backgroundHover;
                    header.style.boxShadow = theme.card.shadow;
                });
                header.addEventListener('mouseleave', () => {
                    header.style.background = theme.card.background;
                    header.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
                });
                
                header.addEventListener('click', () => {
                    const quizzesList = header.nextElementSibling;
                    const expandIcon = header.querySelector('.history-expand-icon');
                    
                    if (quizzesList.style.display === 'none') {
                        quizzesList.style.display = 'block';
                        expandIcon.style.transform = 'rotate(90deg)';
                    } else {
                        quizzesList.style.display = 'none';
                        expandIcon.style.transform = 'rotate(0deg)';
                    }
                });
            });

            // Add hover effects for quiz items
            container.querySelectorAll('.history-quiz-item').forEach(item => {
                item.addEventListener('mouseenter', () => {
                    item.style.background = theme.card.backgroundHover;
                    item.style.boxShadow = theme.card.shadow;
                });
                item.addEventListener('mouseleave', () => {
                    item.style.background = theme.card.background;
                    item.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
                });
                
                // Click handler to view quiz questions
                item.addEventListener('click', () => {
                    const quizKey = item.dataset.quizKey;
                    const courseId = item.dataset.courseId;
                    
                    // Render the specific quiz's questions in the same container
                    renderSpecificQuizContent(container, courseId, quizKey, theme);
                });
            });

            // Auto-expand first course group
            const firstHeader = container.querySelector('.history-course-header');
            if (firstHeader) {
                firstHeader.click();
            }

        } catch (error) {
            console.error('Error rendering history view:', error);
            container.innerHTML = `<p style="color: ${theme ? theme.status.incorrect.text : 'red'}; text-align: center; padding: 1rem;">Error loading quiz history.</p>`;
        }
    }

    // Render a specific quiz's questions (for history view)
    function renderSpecificQuizContent(container, courseId, quizKey, theme = THEMES.light) {
        try {
            const allData = retrieveData();
            
            if (!allData || !allData[courseId] || !allData[courseId][quizKey]) {
                container.innerHTML = `<p style='text-align: center; color: ${theme.text.secondary}; padding: 2.5rem 1.25rem;'>Quiz data not found.</p>`;
                return;
            }

            const quiz = allData[courseId][quizKey];
            const courseName = allData[courseId].courseName || `Course ${courseId}`;
            const quizTitle = quiz.quizTitle || `Quiz ${quiz.quizId}`;
            const questions = quiz.questions || [];

            // Filter out error entries
            const validQuestions = questions.filter(q => !q.isError && q.question);

            if (validQuestions.length === 0) {
                container.innerHTML = `<p style='text-align: center; color: ${theme.text.secondary}; padding: 2.5rem 1.25rem;'>No questions found for this quiz.</p>`;
                return;
            }

            let html = '';

            // Quiz header with title, back button, and download report
            html += `
                <div style="margin-bottom: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                        <button id="back-to-history-btn" style="
                            display: inline-flex;
                            align-items: center;
                            gap: 0.375rem;
                            padding: 0.375rem 0.75rem;
                            background: ${theme.button.background};
                            border: 1px solid ${theme.button.border};
                            border-radius: 0.375rem;
                            color: ${theme.text.secondary};
                            font-size: 0.875rem;
                            cursor: pointer;
                            font-family: inherit;
                            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                            transition: background 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                        ">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                            Back to History
                        </button>
                        <button id="download-history-report-btn" style="
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            border-radius: 0.375rem;
                            font-size: 0.875rem;
                            font-weight: 500;
                            height: 2.25rem;
                            padding: 0 1rem;
                            border: 1px solid ${theme.button.border};
                            background: ${theme.button.primaryBg};
                            color: ${theme.button.primaryText};
                            cursor: pointer;
                            gap: 0.5rem;
                            font-family: inherit;
                            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                        ">
                            ${LUCIDE_ICONS.download} Download Report
                        </button>
                    </div>
                    <h2 style="
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: ${theme.text.primary};
                        margin: 0 0 0.25rem 0;
                    ">${quizTitle}</h2>
                    <p style="
                        font-size: 0.875rem;
                        color: ${theme.text.secondary};
                        margin: 0;
                    ">${courseName} • ${validQuestions.length} question${validQuestions.length !== 1 ? 's' : ''}</p>
                </div>
            `;

            // Questions list
            html += '<div class="quiz-questions" style="display: flex; flex-direction: column; gap: 1.5rem;">';

            validQuestions.forEach((question, index) => {
                const questionText = sanitizeHtmlForDisplay(question.question);
                const choices = question.choices || {};
                const questionType = choices.question_type || 'multiple_choice';

                html += `
                    <div class="question-item" style="
                        padding: 1.5rem;
                        background: ${theme.card.background};
                        border: 1px solid ${theme.card.border};
                        border-radius: 0.5rem;
                        box-shadow: ${theme.card.shadow};
                    ">
                        <div style="
                            font-weight: 500;
                            color: ${theme.text.secondary};
                            font-size: 0.75rem;
                            margin-bottom: 0.5rem;
                        ">Question ${index + 1}</div>
                        <div style="
                            color: ${theme.text.primary};
                            margin-bottom: 1rem;
                            line-height: 1.6;
                        ">${questionText}</div>
                `;

                // Render answer choices based on question type
                if (questionType === 'identification' || questionType === 'essay_question' || questionType === 'short_answer_question') {
                    // Text-based question
                    const correctAnswer = choices.correct_text_answer || choices.correct_answer || choices.answer_text || choices.text_answer || null;
                    const incorrectTextAnswers = choices.incorrect_text_answers || [];
                    
                    html += '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
                    
                    // Show correct answer if available
                    if (correctAnswer) {
                        html += `
                            <div style="
                                display: flex;
                                align-items: flex-start;
                                gap: 0.75rem;
                                padding: 0.75rem;
                                background: ${theme.status.correct.bg};
                                border: 1px solid ${theme.status.correct.border};
                                border-radius: 0.375rem;
                                color: ${theme.status.correct.text};
                            ">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${theme.status.correct.text}; flex-shrink: 0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
                                <span style="line-height: 1.5;"><strong>Correct:</strong> ${sanitizeHtmlForDisplay(correctAnswer)}</span>
                            </div>
                        `;
                    }
                    
                    // Show incorrect answers if available
                    if (incorrectTextAnswers.length > 0) {
                        incorrectTextAnswers.forEach(incorrectAnswer => {
                            html += `
                                <div style="
                                    display: flex;
                                    align-items: flex-start;
                                    gap: 0.75rem;
                                    padding: 0.75rem;
                                    background: ${theme.status.incorrect.bg};
                                    border: 1px solid ${theme.status.incorrect.border};
                                    border-radius: 0.375rem;
                                    color: ${theme.status.incorrect.text};
                                ">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${theme.status.incorrect.text}; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                                    <span style="line-height: 1.5;"><strong>Your answer:</strong> ${sanitizeHtmlForDisplay(incorrectAnswer)}</span>
                                </div>
                            `;
                        });
                    }
                    
                    html += '</div>';
                    
                    // Show message only if no answers captured yet
                    if (!correctAnswer && incorrectTextAnswers.length === 0) {
                        const warningBg = 'rgba(251, 191, 36, 0.1)';
                        const warningBorder = 'rgba(251, 191, 36, 0.3)';
                        const warningText = 'hsl(48 96% 20%)';
                        html += `
                            <div style="
                                margin-top: 0.5rem;
                                padding: 0.5rem 0.75rem;
                                background: ${warningBg};
                                border: 1px solid ${warningBorder};
                                border-radius: 0.375rem;
                                font-size: 0.75rem;
                                color: ${warningText};
                            ">
                                Tip: View the quiz results page on Canvas to capture correct answers.
                            </div>
                        `;
                    }
                } else {
                    // Multiple choice or similar - render all choices
                    // Get the correct_answers and incorrect_answers arrays if they exist
                    const correctAnswersArray = choices.correct_answers || [];
                    const incorrectAnswersArray = choices.incorrect_answers || [];
                    
                    const choiceEntries = Object.entries(choices).filter(([key, value]) => {
                        return key !== 'question_type' && 
                               key !== 'correct_answer' && 
                               key !== 'correct_answers' &&
                               key !== 'incorrect_answers' &&
                               key !== 'incorrect_text_answers' &&
                               key !== 'correct_text_answer' &&
                               key !== 'answer_text' &&
                               key !== 'matching_pairs' &&
                               key !== 'text_answer' &&
                               typeof value === 'string' &&
                               value.replace(/<[^>]*>/g, '').trim() !== '';
                    });

                    if (choiceEntries.length > 0) {
                        html += '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
                        
                        choiceEntries.forEach(([answerId, answerText]) => {
                            // Check if this is a correct answer using multiple detection methods
                            const isCorrect = correctAnswersArray.includes(answerId) ||
                                            correctAnswersArray.includes(String(answerId)) ||
                                            correctAnswersArray.includes(parseInt(answerId)) ||
                                            choices[`${answerId}_correct`] === true || 
                                            choices.correct_answer === answerId ||
                                            answerText.includes('[CORRECT]');
                            
                            // Check if this is an incorrect answer (user selected but wrong)
                            const isIncorrect = incorrectAnswersArray.includes(answerId) ||
                                              incorrectAnswersArray.includes(String(answerId)) ||
                                              incorrectAnswersArray.includes(parseInt(answerId));
                            
                            const cleanAnswerText = answerText.replace('[CORRECT]', '').trim();
                            
                            // Determine styling based on correct/incorrect status (using theme)
                            let bgColor, borderColor, textColor, icon;
                            
                            if (isCorrect) {
                                bgColor = theme.status.correct.bg;
                                borderColor = theme.status.correct.border;
                                textColor = theme.status.correct.text;
                                icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${theme.status.correct.text}; flex-shrink: 0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>`;
                            } else if (isIncorrect) {
                                bgColor = theme.status.incorrect.bg;
                                borderColor = theme.status.incorrect.border;
                                textColor = theme.status.incorrect.text;
                                icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${theme.status.incorrect.text}; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;
                            } else {
                                bgColor = theme.status.neutral.bg;
                                borderColor = theme.status.neutral.border;
                                textColor = theme.text.primary;
                                icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${theme.status.neutral.text}; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/></svg>`;
                            }

                            html += `
                                <div style="
                                    display: flex;
                                    align-items: flex-start;
                                    gap: 0.75rem;
                                    padding: 0.75rem;
                                    background: ${bgColor};
                                    border: 1px solid ${borderColor};
                                    border-radius: 0.375rem;
                                    color: ${textColor};
                                ">
                                    ${icon}
                                    <span style="line-height: 1.5;">${sanitizeHtmlForDisplay(cleanAnswerText)}</span>
                                </div>
                            `;
                        });

                        html += '</div>';
                    } else if (choices.matching_pairs && Array.isArray(choices.matching_pairs)) {
                        // Handle matching questions
                        html += '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
                        choices.matching_pairs.forEach(pair => {
                            // Get the selected answer text
                            const selectedAnswer = pair.selectedText || pair.match || pair.right || pair.selected || '';
                            const hasSelection = selectedAnswer && selectedAnswer.trim() !== '' && selectedAnswer !== '[ Choose ]';
                            
                            // Check if this pair has correct/incorrect marking
                            const isCorrect = pair.isCorrect === true;
                            const isIncorrect = pair.isCorrect === false && hasSelection;
                            
                            // Determine styling using theme
                            let bgColor, borderColor, answerColor, icon;
                            if (isCorrect) {
                                bgColor = theme.status.correct.bg;
                                borderColor = theme.status.correct.border;
                                answerColor = theme.status.correct.text;
                                icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${theme.status.correct.text}; flex-shrink: 0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>`;
                            } else if (isIncorrect) {
                                bgColor = theme.status.incorrect.bg;
                                borderColor = theme.status.incorrect.border;
                                answerColor = theme.status.incorrect.text;
                                icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${theme.status.incorrect.text}; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;
                            } else {
                                bgColor = theme.status.neutral.bg;
                                borderColor = theme.status.neutral.border;
                                answerColor = theme.text.primary;
                                icon = '';
                            }

                            const displayAnswer = hasSelection ? selectedAnswer : `<em style="color: ${theme.text.secondary};">Not answered</em>`;

                            html += `
                                <div style="
                                    display: flex;
                                    align-items: center;
                                    gap: 0.75rem;
                                    padding: 0.75rem;
                                    background: ${bgColor};
                                    border: 1px solid ${borderColor};
                                    border-radius: 0.375rem;
                                ">
                                    ${icon}
                                    <span style="font-weight: 500; color: ${theme.text.primary}; flex: 1;">${sanitizeHtmlForDisplay(pair.term || 'Term')}</span>
                                    <span style="color: ${theme.text.secondary};">→</span>
                                    <span style="color: ${answerColor}; flex: 1;">${displayAnswer}</span>
                                </div>
                            `;
                        });
                        html += '</div>';
                    } else {
                        html += `<div style="font-size: 0.875rem; color: ${theme.text.secondary}; font-style: italic;">No answer choices stored</div>`;
                    }

                    // Show note only if NO correct AND NO incorrect answers are marked
                    const hasAnyAnswerData = correctAnswersArray.length > 0 || incorrectAnswersArray.length > 0;
                    if (!hasAnyAnswerData && choiceEntries.length > 0) {
                        const warningBg = 'rgba(251, 191, 36, 0.1)';
                        const warningBorder = 'rgba(251, 191, 36, 0.3)';
                        const warningText = 'hsl(48 96% 20%)';
                        html += `
                            <div style="
                                margin-top: 0.75rem;
                                padding: 0.5rem 0.75rem;
                                background: ${warningBg};
                                border: 1px solid ${warningBorder};
                                border-radius: 0.375rem;
                                font-size: 0.75rem;
                                color: ${warningText};
                            ">
                                Tip: View the quiz results page on Canvas to capture correct answers.
                            </div>
                        `;
                    }
                }

                html += '</div>'; // Close question-item
            });

            html += '</div>'; // Close quiz-questions

            container.innerHTML = html;

            // Add back button handler
            const backBtn = container.querySelector('#back-to-history-btn');
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    // Get the current course ID from URL for the view filter
                    const link = window.location.href;
                    let currentCourseId = null;
                    try {
                        currentCourseId = parseInt(link.split("courses/")[1].split("/")[0]);
                    } catch (e) {}
                    
                    renderHistoryView(container, 'all', currentCourseId, 'recent', theme);
                });

                // Hover effect
                backBtn.addEventListener('mouseenter', () => {
                    backBtn.style.background = theme.button.backgroundHover;
                });
                backBtn.addEventListener('mouseleave', () => {
                    backBtn.style.background = theme.button.background;
                });
            }

            // Download report button handler
            const downloadBtn = container.querySelector('#download-history-report-btn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', async () => {
                    try {
                        // Show loading state
                        const originalText = downloadBtn.innerHTML;
                        downloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Processing...`;
                        downloadBtn.disabled = true;

                        // Generate HTML content for download
                        const htmlContent = generateHistoryReportHTML(courseId, quizKey, quizTitle, courseName, validQuestions);
                        
                        // Create and download the file
                        const blob = new Blob([htmlContent], { type: 'text/html' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${quizTitle.replace(/[^a-z0-9]/gi, '_')}_report.html`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);

                        // Reset button
                        downloadBtn.innerHTML = `${LUCIDE_ICONS.checkCircle} Downloaded!`;
                        setTimeout(() => {
                            downloadBtn.innerHTML = originalText;
                            downloadBtn.disabled = false;
                        }, 2000);
                    } catch (error) {
                        console.error('Error downloading report:', error);
                        downloadBtn.innerHTML = `${LUCIDE_ICONS.download} Download Report`;
                        downloadBtn.disabled = false;
                        alert('Error downloading report: ' + error.message);
                    }
                });

                // Hover effect for download button
                downloadBtn.addEventListener('mouseenter', () => {
                    downloadBtn.style.background = theme.button.primaryHover;
                });
                downloadBtn.addEventListener('mouseleave', () => {
                    downloadBtn.style.background = theme.button.primaryBg;
                });
            }

        } catch (error) {
            console.error('Error rendering specific quiz content:', error);
            const theme = THEMES.light;
            container.innerHTML = `<p style="color: ${theme.status.incorrect.text}; text-align: center; padding: 1rem;">Error loading quiz: ${error.message}</p>`;
        }
    }

    // Generate HTML report for history quiz download
    function generateHistoryReportHTML(courseId, quizKey, quizTitle, courseName, questions) {
        let questionsHtml = '';
        
        questions.forEach((question, index) => {
            const questionText = question.question || 'No question text';
            const choices = question.choices || {};
            const questionType = choices.question_type || 'multiple_choice';
            const correctAnswersArray = choices.correct_answers || [];
            const incorrectAnswersArray = choices.incorrect_answers || [];

            questionsHtml += `
                <div class="question">
                    <div class="question-number">Question ${index + 1}</div>
                    <div class="question-text">${questionText}</div>
                    <div class="choices">
            `;

            // Handle text-based questions
            if (questionType === 'identification' || questionType === 'essay_question' || questionType === 'short_answer_question') {
                const correctAnswer = choices.correct_text_answer || choices.correct_answer || choices.answer_text || choices.text_answer;
                const incorrectTextAnswers = choices.incorrect_text_answers || [];

                if (correctAnswer) {
                    questionsHtml += `<div class="choice correct"><span class="icon">${LUCIDE_ICONS.check}</span> <strong>Correct:</strong> ${correctAnswer}</div>`;
                }
                incorrectTextAnswers.forEach(ans => {
                    questionsHtml += `<div class="choice incorrect"><span class="icon">${LUCIDE_ICONS.x}</span> <strong>Your answer:</strong> ${ans}</div>`;
                });
                if (!correctAnswer && incorrectTextAnswers.length === 0) {
                    questionsHtml += `<div class="choice neutral">Text response - no answer captured</div>`;
                }
            } else if (questionType === 'matching' && choices.matching_pairs && Array.isArray(choices.matching_pairs)) {
                // Matching questions
                choices.matching_pairs.forEach(pair => {
                    const selectedAnswer = pair.selectedText || pair.match || '';
                    const hasSelection = selectedAnswer && selectedAnswer.trim() !== '' && selectedAnswer !== '[ Choose ]';
                    const isCorrect = pair.isCorrect === true;
                    const isIncorrect = pair.isCorrect === false && hasSelection;
                    
                    let className = 'neutral';
                    let icon = LUCIDE_ICONS.circle;
                    if (isCorrect) { className = 'correct'; icon = LUCIDE_ICONS.check; }
                    else if (isIncorrect) { className = 'incorrect'; icon = LUCIDE_ICONS.x; }

                    const displayAnswer = hasSelection ? selectedAnswer : '<em>Not answered</em>';
                    questionsHtml += `<div class="choice ${className}"><span class="icon">${icon}</span> <strong>${pair.term || 'Term'}:</strong> → ${displayAnswer}</div>`;
                });
            } else {
                // Multiple choice
                const choiceEntries = Object.entries(choices).filter(([key, value]) => {
                    return key !== 'question_type' && key !== 'correct_answer' && key !== 'correct_answers' &&
                           key !== 'incorrect_answers' && key !== 'incorrect_text_answers' && key !== 'correct_text_answer' &&
                           key !== 'answer_text' && key !== 'matching_pairs' && key !== 'text_answer' &&
                           typeof value === 'string' && value.trim() !== '';
                });

                choiceEntries.forEach(([answerId, answerText]) => {
                    const isCorrect = correctAnswersArray.includes(answerId) || 
                                     correctAnswersArray.includes(String(answerId)) ||
                                     correctAnswersArray.includes(parseInt(answerId));
                    const isIncorrect = incorrectAnswersArray.includes(answerId) ||
                                       incorrectAnswersArray.includes(String(answerId)) ||
                                       incorrectAnswersArray.includes(parseInt(answerId));
                    
                    let className = 'neutral';
                    let icon = LUCIDE_ICONS.circle;
                    if (isCorrect) { className = 'correct'; icon = LUCIDE_ICONS.check; }
                    else if (isIncorrect) { className = 'incorrect'; icon = LUCIDE_ICONS.x; }

                    questionsHtml += `<div class="choice ${className}"><span class="icon">${icon}</span> ${answerText}</div>`;
                });
            }

            questionsHtml += `
                    </div>
                </div>
            `;
        });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${quizTitle} - Quiz Report</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #1f2937;
            background: #f9fafb;
            padding: 2rem;
        }
        .container { max-width: 800px; margin: 0 auto; }
        .header {
            background: white;
            padding: 1.5rem;
            border-radius: 0.5rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .header h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
        .header p { color: #6b7280; font-size: 0.875rem; }
        .question {
            background: white;
            padding: 1.5rem;
            border-radius: 0.5rem;
            margin-bottom: 1rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .question-number { font-size: 0.75rem; color: #6b7280; font-weight: 500; margin-bottom: 0.5rem; }
        .question-text { margin-bottom: 1rem; }
        .question-text img { max-width: 100%; height: auto; }
        .choices { display: flex; flex-direction: column; gap: 0.5rem; }
        .choice {
            padding: 0.75rem;
            border-radius: 0.375rem;
            display: flex;
            align-items: flex-start;
            gap: 0.5rem;
        }
        .choice .icon {
            flex-shrink: 0;
            width: 1.25em;
            height: 1.25em;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-top: 0.05em;
        }
        .choice .icon > svg { width: 1em; height: 1em; display: block; }
        .choice.correct { background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); color: #166534; }
        .choice.incorrect { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #991b1b; }
        .choice.neutral { background: #f9fafb; border: 1px solid #e5e7eb; }
        .footer { text-align: center; color: #9ca3af; font-size: 0.75rem; margin-top: 2rem; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${quizTitle}</h1>
            <p>${courseName} • ${questions.length} questions</p>
        </div>
        ${questionsHtml}
        <div class="footer">Generated by Quiz Fetch</div>
    </div>
</body>
</html>`;
    }

    // ============== END QUIZ HISTORY FUNCTIONS ==============

    // Add buttons to quiz listing page headers
    function setupQuizListingButtons() {
        try {
            // Find all quiz headers on the page
            const quizHeaders = document.querySelectorAll('.quiz-header, .ig-header');

            if (quizHeaders && quizHeaders.length > 0) {

                quizHeaders.forEach(header => {
                    // Create a button to view collected questions
                    const viewButton = document.createElement('button');
                    viewButton.innerText = 'View Questions';
                    viewButton.className = 'btn btn-small view-collected-questions';
                    viewButton.style.marginLeft = '10px';
                    viewButton.style.marginBottom = '10px';
                    viewButton.style.cursor = 'pointer';

                    // Add the button to the header
                    header.appendChild(viewButton);

                    // Add click handler
                    viewButton.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();

                        // Extract course ID and assignment ID from URL
                        const link = window.location.href;
                        let currentCourseId, currentQuizId, currentAssignmentId;

                        try {
                            currentCourseId = parseInt(link.split("courses/")[1].split("/")[0]);

                            // Try to find quiz ID from the header or parent element
                            const quizItem = header.closest('.quiz, .ig-row');
                            if (quizItem) {
                                // Try to get quiz ID from element ID
                                const quizIdMatch = quizItem.id ? quizItem.id.match(/quiz_(\d+)/) : null;
                                if (quizIdMatch) {
                                    currentQuizId = parseInt(quizIdMatch[1]);
                                }

                                // Try to get assignment ID from element attributes
                                if (quizItem.hasAttribute('data-assignment-id')) {
                                    currentAssignmentId = parseInt(quizItem.getAttribute('data-assignment-id'));
                                }
                            }

                            // If we can't find quiz ID from DOM, try URL
                            if (!currentQuizId && link.includes('/quizzes/')) {
                                const quizMatch = link.match(/quizzes\/(\d+)/);
                                if (quizMatch) {
                                    currentQuizId = parseInt(quizMatch[1]);
                                }
                            }

                            // If we can't find assignment ID from DOM, try URL
                            if (!currentAssignmentId && link.includes('/assignments/')) {
                                const assignmentMatch = link.match(/assignments\/(\d+)/);
                                if (assignmentMatch) {
                                    currentAssignmentId = parseInt(assignmentMatch[1]);
                                }
                            }
                        } catch (error) {
                            console.error("Error parsing IDs from listing page:", error);
                            currentCourseId = null;
                            currentQuizId = null;
                            currentAssignmentId = null;
                        }


                        // Get the stored quiz data
                        const quizData = retrieveData();

                        // Initialize empty objects for answers if we don't have submission data
                        // This prevents reference errors when clicking the export buttons
                        let userAnswers = {};
                        let correctAnswers = {};
                        let incorrectAnswers = {};

                        // Try to fetch submission data if possible
                        if (currentCourseId && currentQuizId) {
                            const baseUrl = window.location.origin + '/';
                            try {
                                getQuizSubmissions(currentCourseId, currentQuizId, baseUrl, currentAssignmentId)
                                    .then(submissionData => {
                                        showPopup(quizData, currentCourseId, submissionData);
                                    })
                                    .catch(error => {
                                        console.error("Error fetching submission history:", error);
                                        // Fall back to showing popup without submission data
                                        showPopup(quizData, currentCourseId, null);
                                    });
                            } catch (error) {
                                console.error("Error fetching submission data:", error);
                                showPopup(quizData, currentCourseId, null);
                            }
                        } else {
                            // Show popup with locally stored data if we can't fetch from API
                            showPopup(quizData, currentCourseId, null);
                        }
                    });
                });

            } else {
            }
        } catch (error) {
            console.error("Error setting up quiz listing buttons:", error);
        }
    }

    // Function to add a button to quiz submission pages
    function setupSubmissionPageButton() {
        try {
            // First, remove ALL existing buttons to prevent duplications
            // Remove container elements
            document.querySelectorAll('.quiz-loader-button-container').forEach(container => {
                container.remove();
            });

            // Remove any existing View Collected Questions buttons (from any source)
            document.querySelectorAll('.view-collected-questions').forEach(button => {
                button.remove();
            });

            // Also try removing by text content
            document.querySelectorAll('button').forEach(button => {
                if (button.textContent.includes('View Collected')) {
                    button.remove();
                }
            });

            // Find a good place to add the button - try the quiz title or content header
            const submissionHeader = document.querySelector('.content-header, .quiz-header, .assignment-title, h1');

            if (submissionHeader) {

                // Verify this header doesn't already have a button
                const existingButton = submissionHeader.querySelector('.view-collected-questions');
                if (existingButton) {
                    return;
                }

                // Create a container for the button
                let buttonContainer = document.createElement('div');
                buttonContainer.className = 'quiz-loader-button-container';
                buttonContainer.style.marginTop = '0px'; // No top margin
                buttonContainer.style.marginBottom = '10px'; // Add bottom margin instead
                buttonContainer.style.position = 'relative';
                buttonContainer.style.textAlign = 'center'; // Center the button
                buttonContainer.style.zIndex = '100'; // Ensure it's above other elements

                // Insert at the beginning of the header instead of appending
                submissionHeader.insertBefore(buttonContainer, submissionHeader.firstChild);

                // Create the button
                const viewButton = document.createElement('button');
                viewButton.innerText = 'View Collected Quiz Questions';
                viewButton.className = 'btn btn-primary view-collected-questions';
                viewButton.style.padding = '8px 16px';
                viewButton.style.marginBottom = '10px';
                viewButton.style.cursor = 'pointer';
                viewButton.style.fontSize = '14px';
                viewButton.style.fontWeight = 'bold'; // Make text bold

                // Add the button to the container
                buttonContainer.appendChild(viewButton);

                // Add click handler
                viewButton.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();

                    // Get the stored quiz data first to check what we have
                    const allQuizData = retrieveData();

                    // Initialize empty objects for answers if we don't have submission data
                    // This prevents reference errors when clicking the export buttons
                    let userAnswers = {};
                    let correctAnswers = {};
                    let incorrectAnswers = {};

                    // Extract IDs from the URL
                    const link = window.location.href;
                    let currentCourseId, currentQuizId, currentAssignmentId;

                    try {
                        // Get course ID
                        const courseMatch = link.match(/courses\/(\d+)/);
                        if (courseMatch) {
                            currentCourseId = parseInt(courseMatch[1]);
                        }

                        // Get assignment ID
                        const assignmentMatch = link.match(/assignments\/(\d+)/);
                        if (assignmentMatch) {
                            currentAssignmentId = parseInt(assignmentMatch[1]);
                        }

                        // Look for quiz ID
                        document.querySelectorAll('a[href*="quizzes"]').forEach(link => {
                            const quizMatch = link.href.match(/quizzes\/(\d+)/);
                            if (quizMatch && !currentQuizId) {
                                currentQuizId = parseInt(quizMatch[1]);
                            }
                        });

                        // Check specifically for "Resume Quiz" buttons
                        document.querySelectorAll('.btn.element_toggler[href*="quizzes"], .btn.btn-primary[href*="quizzes"]').forEach(link => {
                            const quizMatch = link.href.match(/quizzes\/(\d+)/);
                            if (quizMatch) {
                                currentQuizId = parseInt(quizMatch[1]);
                            }
                        });

                        // Look for the exact Resume Quiz button format mentioned
                        document.querySelectorAll('a.btn.btn-primary.element_toggler[aria-controls="js-sequential-warning-dialogue"][role="button"]').forEach(link => {
                            const quizMatch = link.href.match(/quizzes\/(\d+)/);
                            if (quizMatch) {
                                currentQuizId = parseInt(quizMatch[1]);
                            }
                        });

                        // Look for resume links with other formats
                        document.querySelectorAll('a.btn').forEach(button => {
                            if (button.textContent.includes('Resume') || button.textContent.includes('Take') || button.textContent.includes('Quiz')) {
                                const quizMatch = button.href.match(/quizzes\/(\d+)/);
                                if (quizMatch) {
                                    currentQuizId = parseInt(quizMatch[1]);
                                }
                            }
                        });

                        // Also check all iframes for quiz content
                        document.querySelectorAll('iframe').forEach(iframe => {
                            try {
                                if (iframe.src && iframe.src.includes('quizzes')) {
                                    const quizMatch = iframe.src.match(/quizzes\/(\d+)/);
                                    if (quizMatch) {
                                        currentQuizId = parseInt(quizMatch[1]);
                                    }
                                }
                            } catch (e) {
                            }
                        });

                        // Look for quiz references in the page text
                        const pageText = document.body.innerText;
                        const quizNumberMatch = pageText.match(/Quiz\s+(\d+)/i);
                        if (quizNumberMatch && !currentQuizId) {
                            currentQuizId = parseInt(quizNumberMatch[1]);
                        }

                        // If we still don't have a quiz ID, check if this assignment ID exists in our stored data
                        if (!currentQuizId && currentAssignmentId && currentCourseId && allQuizData[currentCourseId]) {

                            // Loop through stored quiz keys to find any that contain this assignment ID
                            Object.keys(allQuizData[currentCourseId]).forEach(quizKey => {
                                const quizData = allQuizData[currentCourseId][quizKey];
                                if (quizData.assignmentId == currentAssignmentId) {
                                    currentQuizId = quizData.quizId;
                                }
                            });
                        }

                        // Final fallback: use the assignment ID as the quiz ID
                        if (!currentQuizId && currentAssignmentId) {
                            currentQuizId = currentAssignmentId;
                        }

                    } catch (error) {
                        console.error("Error extracting IDs from submission page:", error);
                    }

                    // Show the popup with all available data
                    showPopup(allQuizData, currentCourseId, null);
                });
            } else {

                // If no header found, create a floating button instead
                const floatingButton = document.createElement('div');
                floatingButton.style.position = 'fixed';
                floatingButton.style.bottom = '20px';
                floatingButton.style.right = '20px';
                floatingButton.style.zIndex = '1000';

                const viewButton = document.createElement('button');
                viewButton.innerText = 'View Collected Quiz Questions';
                viewButton.className = 'btn btn-primary view-collected-questions';
                viewButton.style.padding = '10px 20px';
                viewButton.style.marginBottom = '10px';
                viewButton.style.cursor = 'pointer';

                floatingButton.appendChild(viewButton);
                document.body.appendChild(floatingButton);

                // Add the same click handler as above
                viewButton.addEventListener('click', function (e) {
                    e.preventDefault();

                    // Get the stored quiz data
                    const allQuizData = retrieveData();

                    // Extract IDs from the URL
                    const link = window.location.href;
                    let currentCourseId = null;
                    let currentQuizId = null;
                    let currentAssignmentId = null;

                    try {
                        // Extract course ID
                        const courseMatch = link.match(/courses\/(\d+)/);
                        if (courseMatch) {
                            currentCourseId = parseInt(courseMatch[1]);
                        }

                        // Extract assignment ID
                        const assignmentMatch = link.match(/assignments\/(\d+)/);
                        if (assignmentMatch) {
                            currentAssignmentId = parseInt(assignmentMatch[1]);
                        }

                        // Look for quiz ID
                        document.querySelectorAll('a[href*="quizzes"]').forEach(link => {
                            const quizMatch = link.href.match(/quizzes\/(\d+)/);
                            if (quizMatch && !currentQuizId) {
                                currentQuizId = parseInt(quizMatch[1]);
                            }
                        });

                        // Check specifically for "Resume Quiz" buttons
                        document.querySelectorAll('.btn.element_toggler[href*="quizzes"], .btn.btn-primary[href*="quizzes"]').forEach(link => {
                            const quizMatch = link.href.match(/quizzes\/(\d+)/);
                            if (quizMatch) {
                                currentQuizId = parseInt(quizMatch[1]);
                            }
                        });

                        // Look for the exact Resume Quiz button format mentioned
                        document.querySelectorAll('a.btn.btn-primary.element_toggler[aria-controls="js-sequential-warning-dialogue"][role="button"]').forEach(link => {
                            const quizMatch = link.href.match(/quizzes\/(\d+)/);
                            if (quizMatch) {
                                currentQuizId = parseInt(quizMatch[1]);
                            }
                        });

                        // Look for resume links with other formats
                        document.querySelectorAll('a.btn').forEach(button => {
                            if (button.textContent.includes('Resume') || button.textContent.includes('Take') || button.textContent.includes('Quiz')) {
                                const quizMatch = button.href.match(/quizzes\/(\d+)/);
                                if (quizMatch) {
                                    currentQuizId = parseInt(quizMatch[1]);
                                }
                            }
                        });

                        // Also check all iframes for quiz content
                        document.querySelectorAll('iframe').forEach(iframe => {
                            try {
                                if (iframe.src && iframe.src.includes('quizzes')) {
                                    const quizMatch = iframe.src.match(/quizzes\/(\d+)/);
                                    if (quizMatch) {
                                        currentQuizId = parseInt(quizMatch[1]);
                                    }
                                }
                            } catch (e) {
                            }
                        });

                        // Look for quiz references in the page text
                        const pageText = document.body.innerText;
                        const quizNumberMatch = pageText.match(/Quiz\s+(\d+)/i);
                        if (quizNumberMatch && !currentQuizId) {
                            currentQuizId = parseInt(quizNumberMatch[1]);
                        }

                        // If we still don't have a quiz ID, check if this assignment ID exists in our stored data
                        if (!currentQuizId && currentAssignmentId && currentCourseId && allQuizData[currentCourseId]) {

                            // Loop through stored quiz keys to find any that contain this assignment ID
                            Object.keys(allQuizData[currentCourseId]).forEach(quizKey => {
                                const quizData = allQuizData[currentCourseId][quizKey];
                                if (quizData.assignmentId == currentAssignmentId) {
                                    currentQuizId = quizData.quizId;
                                }
                            });
                        }

                        // Final fallback: use the assignment ID as the quiz ID
                        if (!currentQuizId && currentAssignmentId) {
                            currentQuizId = currentAssignmentId;
                        }

                    } catch (error) {
                        console.error("Error extracting IDs for floating button:", error);
                    }

                    // Show the popup with all available data
                    showPopup(allQuizData, currentCourseId, null);
                });

            }
        } catch (error) {
            console.error("Error setting up submission page button:", error);
        }
    }

    // Handle both DOMContentLoaded and load events to ensure script runs
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initQuizFetcher);
    } else {
        // DOMContentLoaded already fired
        initQuizFetcher();
    }

    // Also handle the window load event as a fallback
    window.addEventListener('load', function () {
        if (!window.quizFetcherInitialized) {
            window.quizFetcherInitialized = true;
            initQuizFetcher();
        }
    });

    // Add a helper to reinitialize if needed
    window.reinitializeQuizFetcher = function () {
        initQuizFetcher();
    };

    // Function to generate text for copying to clipboard
    function generateCopyText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers) {
        try {
            // Ensure we have valid objects to prevent reference errors
            userAnswers = userAnswers || {};
            correctAnswers = correctAnswers || {};
            incorrectAnswers = incorrectAnswers || {};

            // Extract current quiz info if not provided
            if (!currentQuizKey) {
                const link = window.location.href;
                let currentQuizId, currentAssignmentId;
                try {
                    if (link.includes("quizzes/")) {
                        currentQuizId = parseInt(link.split("quizzes/")[1].split("/")[0]);
                    }
                    if (link.includes("assignments/")) {
                        currentAssignmentId = parseInt(link.split("assignments/")[1].split("/")[0]);
                    }

                    // Try other methods to find assignment ID if needed
                    if (!currentAssignmentId) {
                        const assignmentIdMeta = document.querySelector('meta[name="assignment_id"]');
                        if (assignmentIdMeta) {
                            currentAssignmentId = parseInt(assignmentIdMeta.content);
                        }
                    }
                    if (!currentAssignmentId) {
                        const assignmentIdElement = document.querySelector('[data-assignment-id]');
                        if (assignmentIdElement) {
                            currentAssignmentId = parseInt(assignmentIdElement.getAttribute('data-assignment-id'));
                        }
                    }

                    // Determine which quiz to show (by quiz ID and assignment ID)
                    currentQuizKey = currentAssignmentId ? `${currentQuizId}_${currentAssignmentId}` : currentQuizId;

                } catch (error) {
                    console.error("Error parsing quiz/assignment IDs from URL:", error);
                }
            }

            let copyText = `QUIZ QUESTIONS FOR COURSE ${currentCourseId}\n\n`;

            if (!quizData || !quizData[currentCourseId]) {
                return "No quiz data collected yet for this course.";
            }

            // If we have a specific quiz key, only show that quiz's questions
            const courseData = quizData[currentCourseId];
            const quizKeysToShow = currentQuizKey ? [currentQuizKey] : Object.keys(courseData);

            for (const quizKey of quizKeysToShow) {
                const quizData = courseData[quizKey];

                if (!quizData || !quizData.questions || quizData.questions.length === 0) {
                    continue;
                }

                const questions = quizData.questions;
                const quizIdDisplay = quizData.quizId || quizKey;
                const assignmentIdDisplay = quizData.assignmentId ? ` (Assignment ${quizData.assignmentId})` : '';

                // Filter out any duplicate questions (including error entries)
                const uniqueQuestions = [];
                const questionTexts = new Set();
                const questionIds = new Set();

                questions.forEach(q => {
                    // For error entries, use questionId as the unique identifier
                    if (q.isError) {
                        if (!questionIds.has(q.questionId)) {
                            questionIds.add(q.questionId);
                            uniqueQuestions.push(q);
                        }
                    } else {
                        // For successful questions, use question text as before (with fallback to questionId)
                        const questionKey = q.question || q.questionId;
                        if (!questionTexts.has(questionKey)) {
                            questionTexts.add(questionKey);
                            uniqueQuestions.push(q);
                        }
                    }
                });

                copyText += `=== QUIZ ${quizIdDisplay}${assignmentIdDisplay} (${uniqueQuestions.length} unique questions) ===\n\n`;

                uniqueQuestions.forEach((q, index) => {
                    // Handle error entries
                    if (q.isError) {
                        copyText += `${index + 1}. Error fetching question data\n\n`;
                        return;
                    }

                    // Get answer status for successful questions
                    const hasCorrectAnswer = q.questionId in correctAnswers && correctAnswers[q.questionId] === true;
                    const hasIncorrectAnswer = q.questionId in correctAnswers && correctAnswers[q.questionId] === false;
                    const answerStatus = hasCorrectAnswer ? "[Correct]" :
                        (hasIncorrectAnswer ? "[Incorrect]" : "[Not answered]");

                    copyText += `Question ${index + 1}: ${convertHtmlToPlainText(q.question) || 'No question text'} ${answerStatus}\n\n`;

                    // Check if this is an identification/text input question or matching question
                    const isIdentificationQuestion = q.choices && q.choices.question_type === "identification";
                    const isMatchingQuestion = q.choices && q.choices.question_type === "matching";

                    // Add choices to the text
                    if (isMatchingQuestion) {
                        copyText += "Matching Pairs:\n";
                        const matchingPairs = q.choices.matching_pairs || [];
                        matchingPairs.forEach(pair => {
                            const hasSelection = pair.selectedValue && pair.selectedValue !== '';
                            const suffix = hasCorrectAnswer ? " ✓" : (hasIncorrectAnswer ? " ✗" : "");
                            copyText += `  ${pair.term} → ${hasSelection ? pair.selectedText : '[Not answered]'}${suffix}\n`;
                        });
                    } else if (isIdentificationQuestion) {
                        // Get the text answers
                        let hasDisplayedAnswer = false;
                        copyText += "Choices:\n";

                        // Display correct text answer if available
                        if (userAnswers[q.questionId]) {
                            const textAnswers = Array.isArray(userAnswers[q.questionId]) ?
                                userAnswers[q.questionId].filter(a => a && a.type === 'text') : [];

                            // Find the correct text answer first, or any text answer if no correct one
                            const correctTextAnswer = textAnswers.find(a => a && a.isCorrect);
                            const anyTextAnswer = textAnswers.length > 0 ? textAnswers[0] : null;

                            const answerToShow = correctTextAnswer || anyTextAnswer;

                            // Show the answer with appropriate mark
                            if (answerToShow) {
                                const suffix = (correctTextAnswer || hasCorrectAnswer) ? " ✓" : " ✗";
                                copyText += `  ${answerToShow.value}${suffix}\n`;
                                hasDisplayedAnswer = true;
                            }
                        }

                        // If no submission history answer found but we have the stored input, show that
                        if (!hasDisplayedAnswer && q.choices.text_answer) {
                            // Show with checkmark or X based on whether question was marked correct
                            const suffix = hasCorrectAnswer ? " ✓" : " ✗";
                            copyText += `  ${q.choices.text_answer}${suffix}\n`;
                        }
                    }
                    else if (q.choices && Object.keys(q.choices).length > 0) {
                        copyText += "Choices:\n";

                        Object.entries(q.choices).forEach(([choiceId, choiceText]) => {
                            // Skip metadata keys - these are not actual answer choices
                            if (choiceId === "question_type" || choiceId === "text_answer" || 
                                choiceId === "correct_answers" || choiceId === "incorrect_answers" || choiceId === "correct_text_answer" || choiceId === "incorrect_text_answers" || choiceId === "matching_pairs") return;

                            // Handle the special case of answer_XXX properties for multiple choice
                            let matchedByAnswerProperty = false;
                            if (userAnswers[q.questionId] && Array.isArray(userAnswers[q.questionId])) {
                                // For multiple choice questions, we store the answer IDs from answer_XXX properties
                                matchedByAnswerProperty = userAnswers[q.questionId].some(
                                    id => String(id) === String(choiceId) || Number(id) === Number(choiceId)
                                );
                            }

                            const wasCorrectAnswer = (
                                matchedByAnswerProperty ||
                                (
                                    // Check for direct string match (old format)
                                    (userAnswers[q.questionId] &&
                                        String(userAnswers[q.questionId]) === String(choiceId)) ||
                                    // Check for direct number match
                                    (userAnswers[q.questionId] &&
                                        Number(userAnswers[q.questionId]) === Number(choiceId))
                                )
                            ) && correctAnswers[q.questionId] === true;

                            const wasIncorrectAnswer = incorrectAnswers[q.questionId] &&
                                incorrectAnswers[q.questionId].some(
                                    id => String(id) === String(choiceId) || Number(id) === Number(choiceId)
                                );

                            let suffix = "";
                            if (wasCorrectAnswer) {
                                suffix = " ✓";
                            } else if (wasIncorrectAnswer) {
                                suffix = " ✗";
                            }

                            copyText += `  ${convertHtmlToPlainText(choiceText)}${suffix}\n`;
                        });
                    } else {
                        copyText += "No choices available\n";
                    }

                    copyText += "\n"; // Add a blank line between questions
                });
            }

            return copyText;
        } catch (error) {
            console.error("Error generating copy text:", error);
            return "Error generating copy text.";
        }
    }

    // Function to generate Markdown text for copying
    function generateMarkdownText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers) {
        try {
            userAnswers = userAnswers || {};
            correctAnswers = correctAnswers || {};
            incorrectAnswers = incorrectAnswers || {};

            if (!currentQuizKey) {
                const link = window.location.href;
                let currentQuizId, currentAssignmentId;
                if (link.includes("quizzes/")) {
                    currentQuizId = parseInt(link.split("quizzes/")[1].split("/")[0]);
                }
                if (link.includes("assignments/")) {
                    currentAssignmentId = parseInt(link.split("assignments/")[1].split("/")[0]);
                }
                currentQuizKey = currentAssignmentId ? `${currentQuizId}_${currentAssignmentId}` : currentQuizId;
            }

            let markdown = `# Quiz Questions - Course ${currentCourseId}\n\n`;

            if (!quizData || !quizData[currentCourseId]) {
                return "No quiz data collected yet for this course.";
            }

            const courseData = quizData[currentCourseId];
            const quizKeysToShow = currentQuizKey ? [currentQuizKey] : Object.keys(courseData);

            for (const quizKey of quizKeysToShow) {
                const quiz = courseData[quizKey];
                if (!quiz || !quiz.questions || quiz.questions.length === 0) continue;

                const questions = quiz.questions;
                const uniqueQuestions = [];
                const questionTexts = new Set();

                questions.forEach(q => {
                    if (q.isError) {
                        uniqueQuestions.push(q);
                    } else {
                        const questionKey = q.question || q.questionId;
                        if (!questionTexts.has(questionKey)) {
                            questionTexts.add(questionKey);
                            uniqueQuestions.push(q);
                        }
                    }
                });

                markdown += `## Quiz ${quiz.quizId || quizKey}\n\n`;

                uniqueQuestions.forEach((q, index) => {
                    if (q.isError) {
                        markdown += `### ${index + 1}. Error fetching question\n\n`;
                        return;
                    }

                    const hasCorrectAnswer = correctAnswers[q.questionId] === true;
                    const hasIncorrectAnswer = correctAnswers[q.questionId] === false;
                    const status = hasCorrectAnswer ? '✓' : (hasIncorrectAnswer ? '✗' : '○');

                    markdown += `### ${index + 1}. ${convertHtmlToPlainText(q.question) || 'No question text'} ${status}\n\n`;

                    const isMatchingQuestion = q.choices && q.choices.question_type === "matching";
                    const isIdentificationQuestion = q.choices && q.choices.question_type === "identification";

                    if (isMatchingQuestion) {
                        markdown += "| Term | Match |\n|------|-------|\n";
                        const pairs = q.choices.matching_pairs || [];
                        pairs.forEach(pair => {
                            const match = pair.selectedText || '_Not answered_';
                            markdown += `| ${pair.term} | ${match} |\n`;
                        });
                    } else if (isIdentificationQuestion) {
                        if (q.choices.text_answer) {
                            const mark = hasCorrectAnswer ? '✓' : '✗';
                            markdown += `**Answer:** ${q.choices.text_answer} ${mark}\n`;
                        }
                    } else if (q.choices && Object.keys(q.choices).length > 0) {
                        Object.entries(q.choices).forEach(([choiceId, choiceText]) => {
                            if (choiceId === "question_type" || choiceId === "text_answer" || 
                                choiceId === "correct_answers" || choiceId === "incorrect_answers" || choiceId === "correct_text_answer" || choiceId === "incorrect_text_answers" || choiceId === "matching_pairs") return;

                            const wasCorrect = userAnswers[q.questionId] && 
                                (String(userAnswers[q.questionId]) === String(choiceId) ||
                                 (Array.isArray(userAnswers[q.questionId]) && 
                                  userAnswers[q.questionId].some(id => String(id) === String(choiceId)))) &&
                                correctAnswers[q.questionId] === true;
                            const wasIncorrect = incorrectAnswers[q.questionId] &&
                                incorrectAnswers[q.questionId].some(id => String(id) === String(choiceId));

                            let marker = '-';
                            if (wasCorrect) marker = '- [x] ✓';
                            else if (wasIncorrect) marker = '- [x] ✗';

                            markdown += `${marker} ${convertHtmlToPlainText(choiceText)}\n`;
                        });
                    }

                    markdown += "\n---\n\n";
                });
            }

            return markdown;
        } catch (error) {
            console.error("Error generating markdown:", error);
            return "Error generating markdown.";
        }
    }

    // Function to generate Anki-compatible text (tab-separated: front, back)
    function generateAnkiText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers) {
        try {
            userAnswers = userAnswers || {};
            correctAnswers = correctAnswers || {};
            incorrectAnswers = incorrectAnswers || {};

            if (!currentQuizKey) {
                const link = window.location.href;
                let currentQuizId, currentAssignmentId;
                if (link.includes("quizzes/")) {
                    currentQuizId = parseInt(link.split("quizzes/")[1].split("/")[0]);
                }
                if (link.includes("assignments/")) {
                    currentAssignmentId = parseInt(link.split("assignments/")[1].split("/")[0]);
                }
                currentQuizKey = currentAssignmentId ? `${currentQuizId}_${currentAssignmentId}` : currentQuizId;
            }

            let ankiText = '';

            if (!quizData || !quizData[currentCourseId]) {
                return "No quiz data collected yet for this course.";
            }

            const courseData = quizData[currentCourseId];
            const quizKeysToShow = currentQuizKey ? [currentQuizKey] : Object.keys(courseData);

            for (const quizKey of quizKeysToShow) {
                const quiz = courseData[quizKey];
                if (!quiz || !quiz.questions || quiz.questions.length === 0) continue;

                const questions = quiz.questions;
                const uniqueQuestions = [];
                const questionTexts = new Set();

                questions.forEach(q => {
                    if (!q.isError) {
                        const questionKey = q.question || q.questionId;
                        if (!questionTexts.has(questionKey)) {
                            questionTexts.add(questionKey);
                            uniqueQuestions.push(q);
                        }
                    }
                });

                uniqueQuestions.forEach(q => {
                    const questionText = convertHtmlToPlainText(q.question) || 'No question text';
                    let answerText = '';

                    const isMatchingQuestion = q.choices && q.choices.question_type === "matching";
                    const isIdentificationQuestion = q.choices && q.choices.question_type === "identification";

                    if (isMatchingQuestion) {
                        const pairs = q.choices.matching_pairs || [];
                        answerText = pairs.map(p => `${p.term} → ${p.selectedText || '?'}`).join('<br>');
                    } else if (isIdentificationQuestion) {
                        answerText = q.choices.text_answer || 'No answer';
                    } else if (q.choices && Object.keys(q.choices).length > 0) {
                        // Find correct answers
                        const correctChoices = [];
                        Object.entries(q.choices).forEach(([choiceId, choiceText]) => {
                            if (choiceId === "question_type" || choiceId === "text_answer" || 
                                choiceId === "correct_answers" || choiceId === "incorrect_answers" || choiceId === "correct_text_answer" || choiceId === "incorrect_text_answers" || choiceId === "matching_pairs") return;

                            const wasCorrect = userAnswers[q.questionId] && 
                                (String(userAnswers[q.questionId]) === String(choiceId) ||
                                 (Array.isArray(userAnswers[q.questionId]) && 
                                  userAnswers[q.questionId].some(id => String(id) === String(choiceId)))) &&
                                correctAnswers[q.questionId] === true;

                            if (wasCorrect) {
                                correctChoices.push(convertHtmlToPlainText(choiceText));
                            }
                        });

                        if (correctChoices.length > 0) {
                            answerText = correctChoices.join('<br>');
                        } else {
                            // If no correct answer identified, list all choices
                            const allChoices = [];
                            Object.entries(q.choices).forEach(([choiceId, choiceText]) => {
                                if (choiceId === "question_type" || choiceId === "text_answer" || 
                                    choiceId === "correct_answers" || choiceId === "incorrect_answers" || choiceId === "correct_text_answer" || choiceId === "incorrect_text_answers" || choiceId === "matching_pairs") return;
                                allChoices.push(convertHtmlToPlainText(choiceText));
                            });
                            answerText = allChoices.join('<br>');
                        }
                    }

                    // Anki format: Front TAB Back (escape tabs and newlines)
                    const front = questionText.replace(/\t/g, ' ').replace(/\n/g, '<br>');
                    const back = answerText.replace(/\t/g, ' ').replace(/\n/g, '<br>');
                    ankiText += `${front}\t${back}\n`;
                });
            }

            return ankiText;
        } catch (error) {
            console.error("Error generating Anki text:", error);
            return "Error generating Anki text.";
        }
    }

    // Function to generate Quizlet-compatible text (tab-separated: term, definition)
    function generateQuizletText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers) {
        try {
            userAnswers = userAnswers || {};
            correctAnswers = correctAnswers || {};
            incorrectAnswers = incorrectAnswers || {};

            if (!currentQuizKey) {
                const link = window.location.href;
                let currentQuizId, currentAssignmentId;
                if (link.includes("quizzes/")) {
                    currentQuizId = parseInt(link.split("quizzes/")[1].split("/")[0]);
                }
                if (link.includes("assignments/")) {
                    currentAssignmentId = parseInt(link.split("assignments/")[1].split("/")[0]);
                }
                currentQuizKey = currentAssignmentId ? `${currentQuizId}_${currentAssignmentId}` : currentQuizId;
            }

            let quizletText = '';

            if (!quizData || !quizData[currentCourseId]) {
                return "No quiz data collected yet for this course.";
            }

            const courseData = quizData[currentCourseId];
            const quizKeysToShow = currentQuizKey ? [currentQuizKey] : Object.keys(courseData);

            for (const quizKey of quizKeysToShow) {
                const quiz = courseData[quizKey];
                if (!quiz || !quiz.questions || quiz.questions.length === 0) continue;

                const questions = quiz.questions;
                const uniqueQuestions = [];
                const questionTexts = new Set();

                questions.forEach(q => {
                    if (!q.isError) {
                        const questionKey = q.question || q.questionId;
                        if (!questionTexts.has(questionKey)) {
                            questionTexts.add(questionKey);
                            uniqueQuestions.push(q);
                        }
                    }
                });

                uniqueQuestions.forEach(q => {
                    const questionText = convertHtmlToPlainText(q.question) || 'No question text';
                    let answerText = '';

                    const isMatchingQuestion = q.choices && q.choices.question_type === "matching";
                    const isIdentificationQuestion = q.choices && q.choices.question_type === "identification";

                    if (isMatchingQuestion) {
                        // For matching, create separate cards for each pair
                        const pairs = q.choices.matching_pairs || [];
                        pairs.forEach(p => {
                            if (p.term && p.selectedText) {
                                const term = p.term.replace(/\t/g, ' ').replace(/\n/g, ' ');
                                const match = p.selectedText.replace(/\t/g, ' ').replace(/\n/g, ' ');
                                quizletText += `${term}\t${match}\n`;
                            }
                        });
                        return; // Skip the main question for matching
                    } else if (isIdentificationQuestion) {
                        answerText = q.choices.text_answer || '';
                    } else if (q.choices && Object.keys(q.choices).length > 0) {
                        // Find the correct answer
                        const correctChoices = [];
                        Object.entries(q.choices).forEach(([choiceId, choiceText]) => {
                            if (choiceId === "question_type" || choiceId === "text_answer" || 
                                choiceId === "correct_answers" || choiceId === "incorrect_answers" || choiceId === "correct_text_answer" || choiceId === "incorrect_text_answers" || choiceId === "matching_pairs") return;

                            // Check if user selected this and it was correct
                            let userSelectedThis = false;
                            if (userAnswers[q.questionId] && Array.isArray(userAnswers[q.questionId])) {
                                userSelectedThis = userAnswers[q.questionId].some(
                                    id => String(id) === String(choiceId) || Number(id) === Number(choiceId)
                                );
                            } else if (userAnswers[q.questionId]) {
                                userSelectedThis = String(userAnswers[q.questionId]) === String(choiceId) ||
                                                  Number(userAnswers[q.questionId]) === Number(choiceId);
                            }

                            const isCorrect = userSelectedThis && correctAnswers[q.questionId] === true;
                            if (isCorrect) {
                                correctChoices.push(convertHtmlToPlainText(choiceText));
                            }
                        });

                        answerText = correctChoices.join('; ');
                    }

                    // Only add if we have both question and answer
                    if (questionText && answerText) {
                        const term = questionText.replace(/\t/g, ' ').replace(/\n/g, ' ');
                        const definition = answerText.replace(/\t/g, ' ').replace(/\n/g, ' ');
                        quizletText += `${term}\t${definition}\n`;
                    }
                });
            }

            return quizletText;
        } catch (error) {
            console.error("Error generating Quizlet text:", error);
            return "Error generating Quizlet text.";
        }
    }

    // Function to generate HTML text for copying to clipboard with color highlights
    function generateHtmlCopyText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers) {
        try {
            // Ensure we have valid objects to prevent reference errors
            userAnswers = userAnswers || {};
            correctAnswers = correctAnswers || {};
            incorrectAnswers = incorrectAnswers || {};

            // Extract current quiz info if not provided
            if (!currentQuizKey) {
                const link = window.location.href;
                let currentQuizId, currentAssignmentId;
                try {
                    if (link.includes("quizzes/")) {
                        currentQuizId = parseInt(link.split("quizzes/")[1].split("/")[0]);
                    }
                    if (link.includes("assignments/")) {
                        currentAssignmentId = parseInt(link.split("assignments/")[1].split("/")[0]);
                    }

                    // Try other methods to find assignment ID if needed
                    if (!currentAssignmentId) {
                        const assignmentIdMeta = document.querySelector('meta[name="assignment_id"]');
                        if (assignmentIdMeta) {
                            currentAssignmentId = parseInt(assignmentIdMeta.content);
                        }
                    }
                    if (!currentAssignmentId) {
                        const assignmentIdElement = document.querySelector('[data-assignment-id]');
                        if (assignmentIdElement) {
                            currentAssignmentId = parseInt(assignmentIdElement.getAttribute('data-assignment-id'));
                        }
                    }

                    // Determine which quiz to show (by quiz ID and assignment ID)
                    currentQuizKey = currentAssignmentId ? `${currentQuizId}_${currentAssignmentId}` : currentQuizId;

                } catch (error) {
                    console.error("Error parsing quiz/assignment IDs from URL:", error);
                }
            }

            let htmlContent = `<div style="font-family: Arial, sans-serif;">
                    <h2>QUIZ QUESTIONS FOR COURSE ${currentCourseId}</h2>`;

            if (!quizData || !quizData[currentCourseId]) {
                return "<p>No quiz data collected yet for this course.</p></div>";
            }

            // If we have a specific quiz key, only show that quiz's questions
            const courseData = quizData[currentCourseId];
            const quizKeysToShow = currentQuizKey ? [currentQuizKey] : Object.keys(courseData);

            for (const quizKey of quizKeysToShow) {
                const quizData = courseData[quizKey];

                if (!quizData || !quizData.questions || quizData.questions.length === 0) {
                    continue;
                }

                const questions = quizData.questions;
                const quizIdDisplay = quizData.quizId || quizKey;
                const assignmentIdDisplay = quizData.assignmentId ? ` (Assignment ${quizData.assignmentId})` : '';

                // Filter out any duplicate questions
                const uniqueQuestions = [];
                const questionTexts = new Set();

                questions.forEach(q => {
                    if (!questionTexts.has(q.question)) {
                        questionTexts.add(q.question);
                        uniqueQuestions.push(q);
                    }
                });

                htmlContent += `<h3>=== QUIZ ${quizIdDisplay}${assignmentIdDisplay} (${uniqueQuestions.length} unique questions) ===</h3>`;

                uniqueQuestions.forEach((q, index) => {
                    // Get answer status
                    const hasCorrectAnswer = q.questionId in correctAnswers && correctAnswers[q.questionId] === true;
                    const hasIncorrectAnswer = q.questionId in correctAnswers && correctAnswers[q.questionId] === false;

                    const statusColor = hasCorrectAnswer ?
                        'color: green; font-weight: bold;' :
                        (hasIncorrectAnswer ? 'color: red; font-weight: bold;' : 'color: gray;');

                    const statusText = hasCorrectAnswer ? "[Correct]" :
                        (hasIncorrectAnswer ? "[Incorrect]" : "[Not answered]");

                    // Safely render HTML content allowing certain tags like images
                    const safeQuestionText = sanitizeHtmlForDisplay(q.question || 'No question text');

                    htmlContent += `<div style="margin-bottom: 15px;">
                            <div style="margin-bottom: 8px;">${safeQuestionText} 
                            <span style="${statusColor}">${statusText}</span></div>`;

                    // Check if this is an identification/text input question or matching question
                    const isIdentificationQuestion = q.choices && q.choices.question_type === "identification";
                    const isMatchingQuestion = q.choices && q.choices.question_type === "matching";

                    // Add choices to the text
                    if (isMatchingQuestion) {
                        htmlContent += `<div style="margin-top: 5px;"><strong>Matching Pairs:</strong></div><ul style="margin-top: 5px;">`;
                        const matchingPairs = q.choices.matching_pairs || [];
                        matchingPairs.forEach(pair => {
                            const hasSelection = pair.selectedValue && pair.selectedValue !== '';
                            const suffix = hasCorrectAnswer ? " ✓" : (hasIncorrectAnswer ? " ✗" : "");
                            const style = hasCorrectAnswer ? "color: #28a745; font-weight: bold;" : (hasIncorrectAnswer ? "color: #dc3545;" : "color: #000000;");
                            htmlContent += `<li style="${style}">${pair.term} → ${hasSelection ? pair.selectedText : '<em>Not answered</em>'}${suffix}</li>`;
                        });
                        htmlContent += `</ul>`;
                    } else if (isIdentificationQuestion) {
                        // Get the text answers
                        let hasDisplayedAnswer = false;

                        // Display correct text answer if available
                        if (userAnswers[q.questionId]) {
                            const textAnswers = Array.isArray(userAnswers[q.questionId]) ?
                                userAnswers[q.questionId].filter(a => a && a.type === 'text') : [];

                            // Find the correct text answer
                            const correctTextAnswer = textAnswers.find(a => a && a.isCorrect);

                            // Show the correct answer with green highlight - move checkmark to the right
                            if (correctTextAnswer) {
                                htmlContent += `<p style="margin-left: 20px"><span style="background-color: rgba(0, 128, 0, 0.2); color: green; font-weight: bold; padding: 3px 6px; border-radius: 3px;">${correctTextAnswer.value} ✓</span></p>`;
                                hasDisplayedAnswer = true;
                            }
                        }

                        // If no correct answer found but we have the user's input, show that
                        if (!hasDisplayedAnswer && q.choices.text_answer) {
                            // Add the checkmark or X mark at the end
                            const suffix = hasCorrectAnswer ? " ✓" : " ✗";
                            const style = hasCorrectAnswer ?
                                "background-color: rgba(0, 128, 0, 0.2); color: green; font-weight: bold; padding: 3px 6px; border-radius: 3px;" :
                                "background-color: rgba(255, 0, 0, 0.2); color: red; padding: 3px 6px; border-radius: 3px;";

                            htmlContent += `<p style="margin-left: 20px"><span style="${style}">${q.choices.text_answer}${suffix}</span></p>`;
                        }
                    }
                    else if (q.choices && Object.keys(q.choices).length > 0) {
                        // Use proper HTML list structure
                        htmlContent += `<ul style="margin-top: 5px;">`;

                        Object.entries(q.choices).forEach(([choiceId, choiceText]) => {
                            // Skip metadata keys - these are not actual answer choices
                            if (choiceId === "question_type" || choiceId === "text_answer" || 
                                choiceId === "correct_answers" || choiceId === "incorrect_answers" || choiceId === "correct_text_answer" || choiceId === "incorrect_text_answers" || choiceId === "matching_pairs") return;

                            // Handle the special case of answer_XXX properties for multiple choice
                            let matchedByAnswerProperty = false;
                            if (userAnswers[q.questionId] && Array.isArray(userAnswers[q.questionId])) {
                                // For multiple choice questions, we store the answer IDs from answer_XXX properties
                                matchedByAnswerProperty = userAnswers[q.questionId].some(
                                    id => String(id) === String(choiceId) || Number(id) === Number(choiceId)
                                );
                            }

                            const wasCorrectAnswer = (
                                matchedByAnswerProperty ||
                                (
                                    // Check for direct string match (old format)
                                    (userAnswers[q.questionId] &&
                                        String(userAnswers[q.questionId]) === String(choiceId)) ||
                                    // Check for direct number match
                                    (userAnswers[q.questionId] &&
                                        Number(userAnswers[q.questionId]) === Number(choiceId))
                                )
                            ) && correctAnswers[q.questionId] === true;

                            const wasIncorrectAnswer = incorrectAnswers[q.questionId] &&
                                incorrectAnswers[q.questionId].some(
                                    id => String(id) === String(choiceId) || Number(id) === Number(choiceId)
                                );

                            // Convert choice text and handle images
                            const cleanChoiceText = convertHtmlToRichText(choiceText);

                            if (wasCorrectAnswer) {
                                htmlContent += `<li style="color: #28a745;"><strong>${cleanChoiceText}</strong> ✓</li>`;
                            } else if (wasIncorrectAnswer) {
                                htmlContent += `<li style="color: #dc3545;">${cleanChoiceText} ✗</li>`;
                            } else {
                                htmlContent += `<li style="color: #000000;">${cleanChoiceText}</li>`;
                            }
                        });

                        htmlContent += `</ul>`;
                    } else {
                        htmlContent += `<p>No choices available</p>`;
                    }

                    htmlContent += `</div>`; // Close question div
                });
            }

            htmlContent += `</div>`; // Close main container div
            return htmlContent;
        } catch (error) {
            console.error("Error generating HTML copy text:", error);
            return "<p>Error generating HTML content.</p>";
        }
    }

    // Function to generate rich formatted text for copying with colors and formatting
    function generateRichCopyText(quizData, currentCourseId, currentQuizKey, userAnswers, correctAnswers, incorrectAnswers) {
        try {
            // Ensure we have valid objects to prevent reference errors
            userAnswers = userAnswers || {};
            correctAnswers = correctAnswers || {};
            incorrectAnswers = incorrectAnswers || {};

            // Extract current quiz info if not provided
            if (!currentQuizKey) {
                const link = window.location.href;
                let currentQuizId, currentAssignmentId;
                try {
                    if (link.includes("quizzes/")) {
                        currentQuizId = parseInt(link.split("quizzes/")[1].split("/")[0]);
                    }
                    if (link.includes("assignments/")) {
                        currentAssignmentId = parseInt(link.split("assignments/")[1].split("/")[0]);
                    }

                    // Try other methods to find assignment ID if needed
                    if (!currentAssignmentId) {
                        const assignmentIdMeta = document.querySelector('meta[name="assignment_id"]');
                        if (assignmentIdMeta) {
                            currentAssignmentId = parseInt(assignmentIdMeta.content);
                        }
                    }
                    if (!currentAssignmentId) {
                        const assignmentIdElement = document.querySelector('[data-assignment-id]');
                        if (assignmentIdElement) {
                            currentAssignmentId = parseInt(assignmentIdElement.getAttribute('data-assignment-id'));
                        }
                    }

                    // Determine which quiz to show (by quiz ID and assignment ID)
                    currentQuizKey = currentAssignmentId ? `${currentQuizId}_${currentAssignmentId}` : currentQuizId;

                } catch (error) {
                    console.error("Error parsing quiz/assignment IDs from URL:", error);
                }
            }

            if (!quizData || !quizData[currentCourseId]) {
                return "<p>No quiz data collected yet for this course.</p>";
            }

            // If we have a specific quiz key, only show that quiz's questions
            const courseData = quizData[currentCourseId];
            const quizKeysToShow = currentQuizKey ? [currentQuizKey] : Object.keys(courseData);

            let htmlContent = '';
            let totalQuestions = 0;
            let correctCount = 0;

            for (const quizKey of quizKeysToShow) {
                const quiz = courseData[quizKey];

                if (!quiz || !quiz.questions || quiz.questions.length === 0) {
                    continue;
                }

                const questions = quiz.questions;

                // Filter out any duplicate questions (including error entries)
                const uniqueQuestions = [];
                const questionTexts = new Set();
                const questionIds = new Set();

                questions.forEach(q => {
                    // For error entries, use questionId as the unique identifier
                    if (q.isError) {
                        if (!questionIds.has(q.questionId)) {
                            questionIds.add(q.questionId);
                            uniqueQuestions.push(q);
                        }
                    } else {
                        // For successful questions, use question text as before (with fallback to questionId)
                        const questionKey = q.question || q.questionId;
                        if (!questionTexts.has(questionKey)) {
                            questionTexts.add(questionKey);
                            uniqueQuestions.push(q);
                        }
                    }
                });

                // Calculate scores for this quiz (only count successful questions)
                uniqueQuestions.forEach(q => {
                    if (!q.isError) {
                        totalQuestions++;
                        if (q.questionId in correctAnswers && correctAnswers[q.questionId] === true) {
                            correctCount++;
                        }
                    }
                });

                uniqueQuestions.forEach((q, index) => {
                    // Handle error entries
                    if (q.isError) {
                        htmlContent += `<p>${index + 1}. Error fetching question data</p><br>`;
                        return;
                    }

                    // Get answer status for successful questions
                    const hasCorrectAnswer = q.questionId in correctAnswers && correctAnswers[q.questionId] === true;
                    const hasIncorrectAnswer = q.questionId in correctAnswers && correctAnswers[q.questionId] === false;

                    // Convert HTML question text to clean text but preserve formatting
                    const cleanQuestionText = convertHtmlToRichText(q.question || 'No question text');

                    // Add question with status indicator but default color
                    if (hasCorrectAnswer) {
                        htmlContent += `<p>${cleanQuestionText} ✓</p>`;
                    } else if (hasIncorrectAnswer) {
                        htmlContent += `<p>${cleanQuestionText} ✗</p>`;
                    } else {
                        htmlContent += `<p>${cleanQuestionText}</p>`;
                    }

                    // Check if this is an identification/text input question or matching question
                    const isIdentificationQuestion = q.choices && q.choices.question_type === "identification";
                    const isMatchingQuestion = q.choices && q.choices.question_type === "matching";

                    // Add choices
                    if (isMatchingQuestion) {
                        htmlContent += `<p style="margin-top: 5px;"><strong>Matching Pairs:</strong></p><ul style="margin-top: 5px;">`;
                        const matchingPairs = q.choices.matching_pairs || [];
                        matchingPairs.forEach(pair => {
                            const hasSelection = pair.selectedValue && pair.selectedValue !== '';
                            const suffix = hasCorrectAnswer ? " ✓" : (hasIncorrectAnswer ? " ✗" : "");
                            const style = hasCorrectAnswer ? "color: #28a745; font-weight: bold;" : (hasIncorrectAnswer ? "color: #dc3545;" : "color: #000000;");
                            htmlContent += `<li style="${style}">${pair.term} → ${hasSelection ? pair.selectedText : '<em>Not answered</em>'}${suffix}</li>`;
                        });
                        htmlContent += `</ul>`;
                    } else if (isIdentificationQuestion) {
                        // Get the text answers
                        let hasDisplayedAnswer = false;

                        // Display answer from submission history if available
                        if (userAnswers[q.questionId]) {
                            const textAnswers = Array.isArray(userAnswers[q.questionId]) ?
                                userAnswers[q.questionId].filter(a => a && a.type === 'text') : [];

                            // Find the correct text answer first, or any text answer if no correct one
                            const correctTextAnswer = textAnswers.find(a => a && a.isCorrect);
                            const anyTextAnswer = textAnswers.length > 0 ? textAnswers[0] : null;

                            const answerToShow = correctTextAnswer || anyTextAnswer;

                            // Show the answer with appropriate styling
                            if (answerToShow) {
                                const isCorrectDisplay = correctTextAnswer || hasCorrectAnswer;
                                if (isCorrectDisplay) {
                                    htmlContent += `<p style="color: #28a745; margin-left: 20px;"><strong>${answerToShow.value}</strong> ✓</p>`;
                                } else {
                                    htmlContent += `<p style="color: #dc3545; margin-left: 20px;">${answerToShow.value} ✗</p>`;
                                }
                                hasDisplayedAnswer = true;
                            }
                        }

                        // If no submission history answer found but we have the stored input, show that
                        if (!hasDisplayedAnswer && q.choices.text_answer) {
                            if (hasCorrectAnswer) {
                                htmlContent += `<p style="color: #28a745; margin-left: 20px;"><strong>${q.choices.text_answer}</strong> ✓</p>`;
                            } else {
                                htmlContent += `<p style="color: #dc3545; margin-left: 20px;">${q.choices.text_answer} ✗</p>`;
                            }
                        }
                    }
                    else if (q.choices && Object.keys(q.choices).length > 0) {
                        // Use proper HTML list structure
                        htmlContent += `<ul style="margin-top: 5px;">`;

                        Object.entries(q.choices).forEach(([choiceId, choiceText]) => {
                            // Skip metadata keys - these are not actual answer choices
                            if (choiceId === "question_type" || choiceId === "text_answer" || 
                                choiceId === "correct_answers" || choiceId === "incorrect_answers" || choiceId === "correct_text_answer" || choiceId === "incorrect_text_answers" || choiceId === "matching_pairs") return;

                            // Handle the special case of answer_XXX properties for multiple choice
                            let matchedByAnswerProperty = false;
                            if (userAnswers[q.questionId] && Array.isArray(userAnswers[q.questionId])) {
                                // For multiple choice questions, we store the answer IDs from answer_XXX properties
                                matchedByAnswerProperty = userAnswers[q.questionId].some(
                                    id => String(id) === String(choiceId) || Number(id) === Number(choiceId)
                                );
                            }

                            const wasCorrectAnswer = (
                                matchedByAnswerProperty ||
                                (
                                    // Check for direct string match (old format)
                                    (userAnswers[q.questionId] &&
                                        String(userAnswers[q.questionId]) === String(choiceId)) ||
                                    // Check for direct number match
                                    (userAnswers[q.questionId] &&
                                        Number(userAnswers[q.questionId]) === Number(choiceId))
                                )
                            ) && correctAnswers[q.questionId] === true;

                            const wasIncorrectAnswer = incorrectAnswers[q.questionId] &&
                                incorrectAnswers[q.questionId].some(
                                    id => String(id) === String(choiceId) || Number(id) === Number(choiceId)
                                );

                            // Convert choice text and handle images
                            const cleanChoiceText = convertHtmlToRichText(choiceText);

                            if (wasCorrectAnswer) {
                                htmlContent += `<li style="color: #28a745;"><strong>${cleanChoiceText}</strong> ✓</li>`;
                            } else if (wasIncorrectAnswer) {
                                htmlContent += `<li style="color: #dc3545;">${cleanChoiceText} ✗</li>`;
                            } else {
                                htmlContent += `<li style="color: #000000;">${cleanChoiceText}</li>`;
                            }
                        });

                        htmlContent += `</ul>`;
                    } else {
                        htmlContent += `<p>No choices available</p>`;
                    }

                    htmlContent += '<br>'; // Add spacing between questions
                });
            }

            // Add score at the top
            const scoreInfo = `<h3 style="color: #333; font-weight: bold;">Score: ${correctCount}/${totalQuestions}</h3><hr><br>`;

            return scoreInfo + htmlContent;
        } catch (error) {
            console.error("Error generating rich copy text:", error);
            return "<p>Error generating formatted content.</p>";
        }
    }

    // Helper function to convert HTML to rich text while preserving images
    function convertHtmlToRichText(htmlString) {
        if (!htmlString) return 'No text';

        // Create a temporary div to work with HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlString;

        // Preserve images - just add styling for better display
        const images = tempDiv.querySelectorAll('img');
        images.forEach(img => {
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            img.style.margin = '5px 0';
        });

        // Convert other HTML elements to preserve basic formatting
        // Keep bold, italic, underline, etc. but clean up complex elements
        const boldElements = tempDiv.querySelectorAll('strong, b');
        boldElements.forEach(el => {
            el.outerHTML = `<strong>${el.innerHTML}</strong>`;
        });

        const italicElements = tempDiv.querySelectorAll('em, i');
        italicElements.forEach(el => {
            el.outerHTML = `<em>${el.innerHTML}</em>`;
        });

        const underlineElements = tempDiv.querySelectorAll('u');
        underlineElements.forEach(el => {
            el.outerHTML = `<u>${el.innerHTML}</u>`;
        });

        // Handle code elements
        const codeElements = tempDiv.querySelectorAll('code');
        codeElements.forEach(el => {
            el.style.backgroundColor = '#f1f1f1';
            el.style.color = '#e53e3e';
            el.style.padding = '0.125rem 0.25rem';
            el.style.borderRadius = '0.25rem';
            el.style.fontSize = '0.875em';
            el.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
        });

        // Handle pre elements
        const preElements = tempDiv.querySelectorAll('pre');
        preElements.forEach(el => {
            el.style.backgroundColor = '#f7fafc';
            el.style.border = '1px solid #e2e8f0';
            el.style.borderRadius = '0.375rem';
            el.style.padding = '0.75rem';
            el.style.marginTop = '0.5rem';
            el.style.marginBottom = '0.5rem';
            el.style.fontSize = '0.875em';
            el.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
            el.style.overflowX = 'auto';
            el.style.whiteSpace = 'pre-wrap';
        });

        // Handle link elements
        const linkElements = tempDiv.querySelectorAll('a');
        linkElements.forEach(el => {
            el.style.color = '#2563eb';
            el.style.textDecoration = 'underline';
            el.target = '_blank';
            el.rel = 'noopener noreferrer';
        });

        // Handle keyboard input (kbd) elements
        const kbdElements = tempDiv.querySelectorAll('kbd');
        kbdElements.forEach(el => {
            el.style.backgroundColor = '#f1f1f1';
            el.style.border = '1px solid #d1d5db';
            el.style.borderRadius = '0.25rem';
            el.style.padding = '0.125rem 0.375rem';
            el.style.fontSize = '0.875em';
            el.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
        });

        // Handle marked/highlighted text
        const markElements = tempDiv.querySelectorAll('mark');
        markElements.forEach(el => {
            el.style.backgroundColor = '#fef08a';
            el.style.padding = '0.125rem 0.25rem';
        });

        // Handle sample output (samp)
        const sampElements = tempDiv.querySelectorAll('samp');
        sampElements.forEach(el => {
            el.style.backgroundColor = '#f1f1f1';
            el.style.color = '#374151';
            el.style.padding = '0.125rem 0.25rem';
            el.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
        });

        // Handle variables (var)
        const varElements = tempDiv.querySelectorAll('var');
        varElements.forEach(el => {
            el.style.fontStyle = 'italic';
            el.style.color = '#7c3aed';
        });

        // Handle abbreviations (abbr)
        const abbrElements = tempDiv.querySelectorAll('abbr');
        abbrElements.forEach(el => {
            el.style.textDecoration = 'underline dotted';
        });

        // Handle blockquotes
        const blockquoteElements = tempDiv.querySelectorAll('blockquote');
        blockquoteElements.forEach(el => {
            el.style.borderLeft = '4px solid #e5e7eb';
            el.style.paddingLeft = '1rem';
            el.style.marginLeft = '0';
            el.style.color = '#6b7280';
            el.style.fontStyle = 'italic';
        });

        // Handle deleted text (del/s)
        const delElements = tempDiv.querySelectorAll('del, s');
        delElements.forEach(el => {
            el.style.textDecoration = 'line-through';
            el.style.color = '#9ca3af';
        });

        // Handle inserted text (ins)
        const insElements = tempDiv.querySelectorAll('ins');
        insElements.forEach(el => {
            el.style.textDecoration = 'underline';
            el.style.color = '#059669';
        });

        // Handle tables
        const tableElements = tempDiv.querySelectorAll('table');
        tableElements.forEach(el => {
            el.style.borderCollapse = 'collapse';
            el.style.width = '100%';
            el.style.fontSize = '0.875em';
        });

        const cellElements = tempDiv.querySelectorAll('th, td');
        cellElements.forEach(el => {
            el.style.border = '1px solid #e5e7eb';
            el.style.padding = '0.5rem';
            el.style.textAlign = 'left';
        });

        const thElements = tempDiv.querySelectorAll('th');
        thElements.forEach(el => {
            el.style.backgroundColor = '#f9fafb';
            el.style.fontWeight = '600';
        });

        // Remove unwanted elements but keep their text content
        const unwantedElements = tempDiv.querySelectorAll('div, span, p:not([style])');
        unwantedElements.forEach(el => {
            el.outerHTML = el.innerHTML + ' ';
        });

        // Clean up line breaks but preserve the HTML structure
        let cleanText = tempDiv.innerHTML
            .replace(/<br\s*\/?>/gi, '<br>')
            .replace(/\s+/g, ' ')
            .trim();

        return cleanText;
    }

    // Helper function to convert HTML to clean plain text for copying
    function convertHtmlToPlainText(htmlString) {
        if (!htmlString) return 'No text';

        // Create a temporary div to work with HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = String(htmlString);

        // Convert <br> tags to line breaks
        tempDiv.querySelectorAll('br').forEach(br => {
            br.replaceWith('\n');
        });

        // Convert <p> tags to paragraphs with proper spacing
        tempDiv.querySelectorAll('p').forEach(p => {
            const content = p.textContent || '';
            p.replaceWith('\n\n' + content + '\n\n');
        });

        // Convert <div> tags to line breaks
        tempDiv.querySelectorAll('div').forEach(div => {
            const content = div.textContent || '';
            div.replaceWith('\n' + content + '\n');
        });

        // Convert list items to bulleted items
        tempDiv.querySelectorAll('li').forEach(li => {
            const content = li.textContent || '';
            li.replaceWith('\n� ' + content);
        });

        // Convert unordered lists
        tempDiv.querySelectorAll('ul, ol').forEach(list => {
            list.replaceWith('\n' + list.textContent + '\n');
        });

        // Handle images - replace with descriptive text
        tempDiv.querySelectorAll('img').forEach(img => {
            const imageUrl = img.src || img.getAttribute('src') || '';
            const altText = img.alt || 'image';
            const imageText = `\n[Image: ${altText}${imageUrl ? ' - ' + imageUrl : ''}]\n`;
            img.replaceWith(imageText);
        });

        // Handle links - keep the text but add URL in brackets
        tempDiv.querySelectorAll('a').forEach(link => {
            const linkText = link.textContent || '';
            const linkUrl = link.href || '';
            const fullLinkText = linkUrl ? `${linkText} (${linkUrl})` : linkText;
            link.replaceWith(fullLinkText);
        });

        // Handle headers to add proper spacing
        tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(header => {
            const content = header.textContent || '';
            header.replaceWith('\n\n' + content.toUpperCase() + '\n' + '='.repeat(content.length) + '\n\n');
        });

        // Handle code elements
        tempDiv.querySelectorAll('code').forEach(code => {
            const content = code.textContent || '';
            code.replaceWith('`' + content + '`');
        });

        // Handle pre elements (code blocks)
        tempDiv.querySelectorAll('pre').forEach(pre => {
            const content = pre.textContent || '';
            pre.replaceWith('\n\n```\n' + content + '\n```\n\n');
        });

        // Handle keyboard input (kbd)
        tempDiv.querySelectorAll('kbd').forEach(kbd => {
            const content = kbd.textContent || '';
            kbd.replaceWith('[' + content + ']');
        });

        // Handle marked/highlighted text (mark)
        tempDiv.querySelectorAll('mark').forEach(mark => {
            const content = mark.textContent || '';
            mark.replaceWith('==' + content + '==');
        });

        // Handle sample output (samp)
        tempDiv.querySelectorAll('samp').forEach(samp => {
            const content = samp.textContent || '';
            samp.replaceWith('`' + content + '`');
        });

        // Handle variables (var)
        tempDiv.querySelectorAll('var').forEach(v => {
            const content = v.textContent || '';
            v.replaceWith('_' + content + '_');
        });

        // Handle abbreviations (abbr) - include title if available
        tempDiv.querySelectorAll('abbr').forEach(abbr => {
            const content = abbr.textContent || '';
            const title = abbr.title || '';
            const replacement = title ? `${content} (${title})` : content;
            abbr.replaceWith(replacement);
        });

        // Handle blockquotes
        tempDiv.querySelectorAll('blockquote').forEach(quote => {
            const content = quote.textContent || '';
            quote.replaceWith('\n> ' + content.split('\n').join('\n> ') + '\n');
        });

        // Handle deleted text (del/s)
        tempDiv.querySelectorAll('del, s').forEach(del => {
            const content = del.textContent || '';
            del.replaceWith('~~' + content + '~~');
        });

        // Handle inserted text (ins)
        tempDiv.querySelectorAll('ins').forEach(ins => {
            const content = ins.textContent || '';
            ins.replaceWith('++' + content + '++');
        });

        // Handle inline quotes (q)
        tempDiv.querySelectorAll('q').forEach(q => {
            const content = q.textContent || '';
            q.replaceWith('"' + content + '"');
        });

        // Handle tables - convert to simple text format
        tempDiv.querySelectorAll('table').forEach(table => {
            let tableText = '\n';
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('th, td');
                const cellTexts = Array.from(cells).map(cell => cell.textContent.trim());
                tableText += '| ' + cellTexts.join(' | ') + ' |\n';
            });
            table.replaceWith(tableText);
        });

        // Handle horizontal rules
        tempDiv.querySelectorAll('hr').forEach(hr => {
            hr.replaceWith('\n---\n');
        });

        // Handle figure captions
        tempDiv.querySelectorAll('figcaption').forEach(caption => {
            const content = caption.textContent || '';
            caption.replaceWith('\n[Caption: ' + content + ']\n');
        });

        // Get the final text content and clean it up
        let cleanText = tempDiv.textContent || tempDiv.innerText || '';

        // Clean up multiple consecutive line breaks (but preserve double line breaks for paragraphs)
        cleanText = cleanText.replace(/\n\s*\n\s*\n+/g, '\n\n');

        // Remove excessive leading/trailing whitespace but preserve internal structure
        cleanText = cleanText.replace(/^\s+|\s+$/g, '');

        // Ensure we don't have empty lines at the start
        cleanText = cleanText.replace(/^\n+/, '');

        return cleanText;
    }

    // Helper function to convert images to base64 for download
    async function convertImagesToBase64(htmlContent) {
        try {
            // Create a temporary div to work with the HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;

            // Find all images in the content
            const images = tempDiv.querySelectorAll('img');
            const imagePromises = [];

            images.forEach(img => {
                const promise = new Promise(async (resolve) => {
                    try {
                        const src = img.src;

                        // Skip if already base64 or data URL
                        if (src.startsWith('data:')) {
                            resolve();
                            return;
                        }

                        // Fetch the image
                        const response = await fetch(src);
                        const blob = await response.blob();

                        // Convert to base64
                        const reader = new FileReader();
                        reader.onload = function () {
                            img.src = reader.result;
                            resolve();
                        };
                        reader.onerror = function () {
                            resolve(); // Continue even if one image fails
                        };
                        reader.readAsDataURL(blob);
                    } catch (error) {
                        resolve(); // Continue even if one image fails
                    }
                });
                imagePromises.push(promise);
            });

            // Wait for all images to be processed
            await Promise.all(imagePromises);

            return tempDiv.innerHTML;
        } catch (error) {
            console.error('Error converting images to base64:', error);
            return htmlContent; // Return original content if conversion fails
        }
    }

    // Generate a full HTML report from a container element
    // Used by both the download button and the Discord webhook sharing
    async function generateFullHtmlReport(containerElement, options = {}) {
        const {
            courseName = 'Course',
            quizTitle = 'Quiz',
            includeSearch = true,
            includeQuizMode = true,
            contributorName = ''
        } = options;

        const version = typeof browser !== 'undefined' ? browser.runtime.getManifest().version : 'unknown';

        // Get the actual popup content HTML
        const popupContent = containerElement.innerHTML;

        // Create a temporary div to manipulate the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = popupContent;

        // Remove export buttons but keep the quiz mode toggle button

        // 1. Remove specific export buttons but keep the toggle mode button
        const exportButtons = tempDiv.querySelectorAll('button:not(.toggle-mode-btn)');
        exportButtons.forEach(button => {
            button.remove();
        });

        // 2. Remove divs that contain only button-related content
        const allDivs = tempDiv.querySelectorAll('div');
        allDivs.forEach(div => {
            const text = div.textContent.trim();
            const onlyButtonContent = (
                (text.includes('Copy All Questions') ||
                    text.includes('Download HTML') ||
                    text.includes('Processing')) &&
                text.length < 200 && // Short text likely to be button container
                div.querySelectorAll('div').length <= 2 // Not deeply nested
            );

            if (onlyButtonContent) {
                div.remove();
            }
        });


        // Get the processed content without buttons
        const contentWithoutButtons = tempDiv.innerHTML;

        // Final cleanup: remove any remaining button elements from the HTML string (except toggle-mode-btn)
        const finalCleanedContent = contentWithoutButtons.replace(/<button(?![^>]*toggle-mode-btn)[^>]*>[\s\S]*?<\/button>/gi, '');

        // Remove any existing search bars to prevent duplicates in the downloaded HTML
        // Create a temporary div to parse and manipulate the HTML
        const searchBarRemovalDiv = document.createElement('div');
        searchBarRemovalDiv.innerHTML = finalCleanedContent;

        // Find and remove all search bars and search inputs
        const searchContainers = searchBarRemovalDiv.querySelectorAll('.search-container, div[style*="margin-bottom"][style*="width: 100%"]');
        searchContainers.forEach(container => {
            // Check if this div contains a search input
            if (container.querySelector('input[placeholder*="Search"]') ||
                container.querySelector('input#question-search-input')) {
                container.remove();
            }
        });

        // Also remove any standalone search inputs
        const searchInputs = searchBarRemovalDiv.querySelectorAll('input[placeholder*="Search"], input#question-search-input');
        searchInputs.forEach(input => {
            // Find the parent container and remove it
            let parent = input.parentElement;
            while (parent && parent.tagName !== 'DIV') {
                parent = parent.parentElement;
            }
            if (parent) {
                parent.remove();
            }
        });

        // Remove "Quiz Questions" headings
        const headings = searchBarRemovalDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');
        headings.forEach(heading => {
            if (heading.textContent && heading.textContent.trim() === 'Quiz Questions') {
                heading.remove();
            }
        });

        const contentWithoutSearchBars = searchBarRemovalDiv.innerHTML;

        // Convert images to base64 for offline viewing
        const processedContent = await convertImagesToBase64(contentWithoutSearchBars);

        // Build the search bar HTML if included
        const searchBarHtml = includeSearch ? `
        <!-- Search bar -->
        <div class="search-container">
            <div class="search-wrapper">
                <div class="search-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="m21 21-4.3-4.3"></path>
                    </svg>
                </div>
                <input id="question-search-input" type="text" placeholder="Search questions...">
                <button id="clear-search-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18"></path>
                        <path d="m6 6 12 12"></path>
                    </svg>
                </button>
            </div>
        </div>
        ` : '';

        // Build the search functionality JS if included
        const searchScript = includeSearch ? `
            const searchInput = document.getElementById('question-search-input');
            const clearSearchBtn = document.getElementById('clear-search-btn');
            const questionCards = document.querySelectorAll('.question-card');
            
            // Function to filter questions based on search term
            const filterQuestions = (searchTerm) => {
                const normalizedSearchTerm = searchTerm.toLowerCase().trim();
                let visibleCount = 0;
                
                questionCards.forEach(card => {
                    // Get the question text from the card (first h3 element)
                    const questionElement = card.querySelector('h3');
                    if (!questionElement) return;
                    
                    // Get the text content of the question
                    const questionText = questionElement.textContent || '';
                    
                    // Check if the question contains the search term
                    const isMatch = questionText.toLowerCase().includes(normalizedSearchTerm);
                    
                    // Show or hide the card based on the match
                    card.style.display = isMatch || normalizedSearchTerm === '' ? 'block' : 'none';
                    
                    // Count visible cards
                    if (isMatch || normalizedSearchTerm === '') {
                        visibleCount++;
                    }
                });
                
                // Show/hide clear button based on search input
                clearSearchBtn.style.display = normalizedSearchTerm ? 'flex' : 'none';
                
                // Show a message if no results found
                let noResultsMsg = document.getElementById('no-search-results');
                if (normalizedSearchTerm && visibleCount === 0) {
                    if (!noResultsMsg) {
                        noResultsMsg = document.createElement('div');
                        noResultsMsg.id = 'no-search-results';
                        document.querySelector('.quiz-questions').appendChild(noResultsMsg);
                    }
                    noResultsMsg.textContent = \`No questions found matching "\${searchTerm}"\`;
                } else if (noResultsMsg) {
                    noResultsMsg.remove();
                }
            };
            
            // Add event listener for search input
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    filterQuestions(e.target.value);
                });
            }
            
            // Add event listener for clear button
            if (clearSearchBtn) {
                clearSearchBtn.addEventListener('click', () => {
                    searchInput.value = '';
                    filterQuestions('');
                    searchInput.focus();
                });
            }
` : '';

        // Build the quiz mode functionality JS if included
        const quizModeScript = includeQuizMode ? `
            // Quiz Mode functionality
            const quizContainer = document.querySelector('.quiz-questions');
            const toggleModeBtn = document.querySelector('.toggle-mode-btn');
            
            if (toggleModeBtn && quizContainer) {
                // Quiz mode functions
                function getCurrentMode() {
                    return quizContainer.classList.contains('quiz-mode') ? 'quiz' : 'normal';
                }

                function applyQuizMode() {
                    quizContainer.classList.add('quiz-mode');
                    
                    // Hide all revealed states
                    const choices = quizContainer.querySelectorAll('.answer-choice');
                    choices.forEach(choice => {
                        choice.classList.remove('revealed');
                    });
                    
                    // Update button
                    toggleModeBtn.innerHTML = \`
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                        Quiz Type
                    \`;
                }

                function applyNormalMode() {
                    quizContainer.classList.remove('quiz-mode');
                    
                    // Show all answers
                    const choices = quizContainer.querySelectorAll('.answer-choice');
                    choices.forEach(choice => {
                        choice.classList.add('revealed');
                    });
                    
                    // Update button
                    toggleModeBtn.innerHTML = \`
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                        Quiz Answers
                    \`;
                }

                function toggleMode() {
                    const currentMode = getCurrentMode();
                    if (currentMode === 'normal') {
                        applyQuizMode();
                    } else {
                        applyNormalMode();
                    }
                }

                function handleChoiceClick(choice) {
                    if (getCurrentMode() === 'quiz') {
                        choice.classList.add('revealed');
                    }
                }

                // Add click handler for mode toggle
                toggleModeBtn.addEventListener('click', toggleMode);

                // Add click handlers for choices
                const choices = quizContainer.querySelectorAll('.answer-choice');
                choices.forEach(choice => {
                    choice.addEventListener('click', () => handleChoiceClick(choice));
                });

                // Initialize in normal mode
                applyNormalMode();
            }
` : '';

        // Build the complete script tag
        const scriptContent = (searchScript || quizModeScript) ? `
    <script>
        // Search functionality
        document.addEventListener('DOMContentLoaded', function() {
${searchScript}${quizModeScript}
        });
    </script>` : '';

        // Build the search-related styles
        const searchStyles = includeSearch ? `
        .search-container {
            margin-bottom: 0rem;
            width: 100%;
        }
        
        .search-wrapper {
            display: flex;
            width: 100%;
            position: relative;
            border-radius: 0.375rem;
            border: 1px solid #e5e7eb;
            background: #ffffff;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            overflow: hidden;
        }
        
        .search-icon {
            display: flex;
            align-items: center;
            padding-left: 0.75rem;
            color: #6b7280;
        }
        
        #question-search-input {
            flex: 1;
            height: 2.5rem;
            margin-top: 0;
            margin-bottom: 0;
            padding: 0 0.75rem;
            border: none;
            outline: none;
            background: transparent;
            font-size: 0.875rem;
            color: #111827;
        }
        
        #clear-search-btn {
            display: none;
            align-items: center;
            justify-content: center;
            padding: 0 0.75rem;
            background: transparent;
            border: none;
            cursor: pointer;
            color: #6b7280;
        }
        
        #no-search-results {
            padding: 2rem;
            text-align: center;
            color: #6b7280;
            font-style: italic;
            width: 100%;
        }
        
        .question-card {
            display: block; /* Will be toggled by search */
        }
` : '';

        // Build the quiz mode styles
        const quizModeStyles = includeQuizMode ? `
        /* Quiz Mode Styles */
        .toggle-mode-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 1rem;
            padding: 0.5rem 1rem;
            background: #0369a1;
            color: white;
            border: none;
            border-radius: 0.375rem;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: background-color 0.2s;
        }

        .toggle-mode-btn:hover {
            background: #0284c7;
        }

        /* Quiz mode: ALL unrevealed answers should look identical */
        .quiz-mode .answer-choice:not(.revealed) {
            background-color: #f9fafb !important;
            color: #374151 !important;
            border: 1px solid #e5e7eb !important;
        }

        /* Quiz mode: replace all icons with neutral circles until revealed */
        .quiz-mode .answer-choice:not(.revealed) .choice-icon {
            position: relative;
        }

        .quiz-mode .answer-choice:not(.revealed) .choice-icon svg {
            display: none !important;
        }

        .quiz-mode .answer-choice:not(.revealed) .choice-icon::after {
            content: '';
            display: inline-block;
            width: 16px;
            height: 16px;
            background-image: url('data:image/svg+xml;utf8,<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%23374151" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>');
            background-size: 16px 16px;
            background-repeat: no-repeat;
        }

        .quiz-mode .answer-choice {
            cursor: pointer;
            transition: background-color 0.2s;
        }

        .quiz-mode .answer-choice:hover {
            background-color: rgba(243, 244, 246, 0.5) !important;
        }

        /* Quiz mode: revealed answers show their original styling and icons */
        .quiz-mode .answer-choice.revealed[data-was-correct="true"] {
            background-color: rgba(220, 252, 231, 0.4) !important;
            color: #166534 !important;
            border: 1px solid rgba(187, 247, 208, 0.5) !important;
        }

        .quiz-mode .answer-choice.revealed[data-was-incorrect="true"] {
            background-color: rgba(254, 226, 226, 0.4) !important;
            color: #dc2626 !important;
            border: 1px solid rgba(254, 202, 202, 0.5) !important;
        }

        .quiz-mode .answer-choice.revealed .choice-icon::after {
            display: none;
        }

        .quiz-mode .answer-choice.revealed .choice-icon svg {
            display: inline !important;
        }

        /* Ensure icons are always visible when not in quiz mode */
        .answer-choice .choice-icon svg {
            display: inline;
        }

        /* Normal mode: show correct/incorrect styling when container doesn't have quiz-mode class */
        .quiz-questions:not(.quiz-mode) .answer-choice[data-was-correct="true"] {
            background-color: rgba(220, 252, 231, 0.6) !important;
            color: #166534 !important;
            border: 1px solid rgba(187, 247, 208, 0.7) !important;
        }

        .quiz-questions:not(.quiz-mode) .answer-choice[data-was-incorrect="true"] {
            background-color: rgba(254, 226, 226, 0.6) !important;
            color: #dc2626 !important;
            border: 1px solid rgba(254, 202, 202, 0.7) !important;
        }
` : '';

        // Wrap in a complete HTML document with search functionality
        const fullHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${quizTitle} - ${courseName}</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            margin: 0;
            padding: 20px; 
            background-color: #ffffff;
            color: #333333;
        }
        
        .quiz-questions { 
            max-width: 800px; 
            margin: 0 auto; 
        }
        
        img { 
            max-width: 100%; 
            height: auto; 
            border-radius: 4px; 
            margin: 5px 0; 
        }
        
        code {
            background-color: #f1f1f1;
            color: #e53e3e;
            padding: 0.125rem 0.25rem;
            border-radius: 0.25rem;
            font-size: 0.875em;
            font-family: Monaco, Menlo, "Ubuntu Mono", monospace;
        }
        
        pre {
            background-color: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 0.375rem;
            padding: 0.75rem;
            margin: 0.5rem 0;
            font-size: 0.875em;
            font-family: Monaco, Menlo, "Ubuntu Mono", monospace;
            overflow-x: auto;
            white-space: pre-wrap;
        }
${searchStyles}${quizModeStyles}
    </style>
</head>
<body>
    <div class="quiz-questions">
        <!-- QuizFetch v${version} -->
        ${(contributorName || getUserName()) ? `<!-- contributed-${contributorName || getUserName()} -->` : ''}
        <div class="report-header" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #e5e7eb;">
            <h1 style="margin: 0 0 0.5rem 0; font-size: 1.5rem; color: #111827;">${quizTitle}</h1>
            <div style="display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.875rem; color: #6b7280;">
                <span><strong>Course:</strong> ${courseName}</span>
            </div>
        </div>
        ${searchBarHtml}
        ${processedContent}
    </div>
    ${scriptContent}
</body>
</html>`;

        return fullHtml;
    }

    // Function to generate simple HTML for download
    function generateEnhancedHTML(content, currentCourseId, quizKeysToShow, courseData) {
        // Create a temporary div to manipulate the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;

        // Remove the export buttons (first div with buttons)
        const buttonsDiv = tempDiv.querySelector('div[style*="margin-bottom: 20px"][style*="display: flex"]');
        if (buttonsDiv) {
            buttonsDiv.remove();
        }

        // Get the processed content without buttons
        const contentWithoutButtons = tempDiv.innerHTML;

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Quiz Report</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            margin: 0;
            padding: 20px; 
            background-color: #ffffff;
            color: #333333;
        }
        
        .quiz-questions { 
            max-width: 800px; 
            margin: 0 auto; 
        }
        
        img { 
            max-width: 100%; 
            height: auto; 
            border-radius: 4px; 
            margin: 5px 0; 
        }
    </style>
</head>
<body>
    <div class="quiz-questions">
        ${contentWithoutButtons}
    </div>
</body>
</html>`;
    }



    // Display onboarding sequence for new users (2-step flow)
    function displayUserOnboarding() {
        if (safeLocalStorageGet(APPLICATION_CONFIG.userOnboarding.hasCompletedIntroduction)) {
            return; // User has already completed onboarding sequence
        }

        // Remove any existing onboarding overlay
        const existing = document.getElementById('quizfetch-onboarding');
        if (existing) existing.remove();

        // Create the onboarding element as a DOM node for reliable event attachment
        const onboardingDiv = document.createElement('div');
        onboardingDiv.id = 'quizfetch-onboarding';
        onboardingDiv.style.position = 'fixed';
        onboardingDiv.style.top = '0';
        onboardingDiv.style.left = '0';
        onboardingDiv.style.width = '100%';
        onboardingDiv.style.height = '100%';
        onboardingDiv.style.background = 'rgba(0, 0, 0, 0.5)';
        onboardingDiv.style.zIndex = '999999';
        onboardingDiv.style.display = 'flex';
        onboardingDiv.style.alignItems = 'center';
        onboardingDiv.style.justifyContent = 'center';
        onboardingDiv.style.fontFamily = `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif`;

        let currentStep = 1;

        function renderStep1() {
            return `
                <div style="
                    background: hsl(0 0% 100%);
                    border: 1px solid hsl(214.3 31.8% 91.4%);
                    border-radius: 0.75rem;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    max-width: 32rem;
                    width: 90%;
                    text-align: center;
                    overflow: hidden;
                ">
                    <!-- Header -->
                    <div style="
                        padding: 1.5rem 2rem 1rem 2rem;
                        background: hsl(210 40% 98%);
                        border-bottom: 1px solid hsl(214.3 31.8% 91.4%);
                    ">
                        <div style="
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            width: 3rem;
                            height: 3rem;
                            border-radius: 50%;
                            background: hsl(222.2 84% 4.9%);
                            margin-bottom: 1rem;
                            color: white;
                            font-size: 24px;
                        ">
                            ${LUCIDE_ICONS.checkCircle}
                        </div>
                        <h2 style="
                            color: hsl(222.2 84% 4.9%);
                            font-size: 1.5rem;
                            font-weight: 600;
                            margin: 0 0 0.5rem 0;
                            line-height: 1.2;
                        ">Welcome to QuizFetch!</h2>
                        <p style="
                            color: hsl(215.4 16.3% 46.9%);
                            font-size: 0.875rem;
                            margin: 0;
                            line-height: 1.5;
                        ">Automatically capture and organize your Canvas quiz questions for easy review and study.</p>
                    </div>
                    
                    <!-- Content -->
                    <div style="padding: 1.5rem 2rem;">
                        <div style="
                            display: flex;
                            flex-direction: column;
                            gap: 1rem;
                            margin-bottom: 1.5rem;
                            text-align: left;
                        ">
                            <div style="
                                display: flex;
                                align-items: flex-start;
                                gap: 0.75rem;
                            ">
                                <div style="
                                    display: inline-flex;
                                    align-items: center;
                                    justify-content: center;
                                    width: 1.75rem;
                                    height: 1.75rem;
                                    border-radius: 0.375rem;
                                    background: hsl(222.2 84% 4.9%);
                                    color: white;
                                    font-size: 14px;
                                    flex-shrink: 0;
                                    margin-top: 0.125rem;
                                ">
                                    ${LUCIDE_ICONS.copy}
                                </div>
                                <div>
                                    <div style="
                                        color: hsl(222.2 84% 4.9%);
                                        font-weight: 600;
                                        font-size: 0.875rem;
                                        margin-bottom: 0.25rem;
                                    ">Take your quiz normally</div>
                                    <div style="
                                        color: hsl(215.4 16.3% 46.9%);
                                        font-size: 0.8125rem;
                                        line-height: 1.4;
                                    ">Questions are captured automatically as you progress through your Canvas quiz</div>
                                </div>
                            </div>
                            
                            <div style="
                                display: flex;
                                align-items: flex-start;
                                gap: 0.75rem;
                            ">
                                <div style="
                                    display: inline-flex;
                                    align-items: center;
                                    justify-content: center;
                                    width: 1.75rem;
                                    height: 1.75rem;
                                    border-radius: 0.375rem;
                                    background: hsl(222.2 84% 4.9%);
                                    color: white;
                                    font-size: 14px;
                                    flex-shrink: 0;
                                    margin-top: 0.125rem;
                                ">
                                    ${LUCIDE_ICONS.circle}
                                </div>
                                <div>
                                    <div style="
                                        color: hsl(222.2 84% 4.9%);
                                        font-weight: 600;
                                        font-size: 0.875rem;
                                        margin-bottom: 0.25rem;
                                    ">Click "View Collected Questions"</div>
                                    <div style="
                                        color: hsl(215.4 16.3% 46.9%);
                                        font-size: 0.8125rem;
                                        line-height: 1.4;
                                    ">Look for the button that appears on quiz pages</div>
                                </div>
                            </div>
                            
                            <div style="
                                display: flex;
                                align-items: flex-start;
                                gap: 0.75rem;
                            ">
                                <div style="
                                    display: inline-flex;
                                    align-items: center;
                                    justify-content: center;
                                    width: 1.75rem;
                                    height: 1.75rem;
                                    border-radius: 0.375rem;
                                    background: hsl(222.2 84% 4.9%);
                                    color: white;
                                    font-size: 14px;
                                    flex-shrink: 0;
                                    margin-top: 0.125rem;
                                ">
                                    ${LUCIDE_ICONS.download}
                                </div>
                                <div>
                                    <div style="
                                        color: hsl(222.2 84% 4.9%);
                                        font-weight: 600;
                                        font-size: 0.875rem;
                                        margin-bottom: 0.25rem;
                                    ">Export for studying</div>
                                    <div style="
                                        color: hsl(215.4 16.3% 46.9%);
                                        font-size: 0.8125rem;
                                        line-height: 1.4;
                                    ">Copy to clipboard or download as HTML for easy review</div>
                                </div>
                            </div>
                        </div>
                        
                            <button id="onboarding-continue-btn" style="
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            gap: 0.375rem;
                            border-radius: 0.375rem;
                            font-size: 0.875rem;
                            font-weight: 500;
                            height: 2.5rem;
                            padding: 0 1.5rem;
                            background: hsl(222.2 84% 4.9%);
                            color: hsl(0 0% 100%);
                            border: none;
                            cursor: pointer;
                            transition: all 0.2s;
                            min-width: 8rem;
                        " onmouseover="this.style.background='hsl(222.2 84% 8%)'" onmouseout="this.style.background='hsl(222.2 84% 4.9%)'">
                            Continue
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        
                        <!-- Step indicators -->
                        <div style="
                            display: flex;
                            justify-content: center;
                            gap: 0.5rem;
                            margin-top: 1.25rem;
                        ">
                            <div style="
                                width: 0.5rem;
                                height: 0.5rem;
                                border-radius: 50%;
                                background: hsl(222.2 84% 4.9%);
                            "></div>
                            <div style="
                                width: 0.5rem;
                                height: 0.5rem;
                                border-radius: 50%;
                                background: hsl(214.3 31.8% 91.4%);
                            "></div>
                        </div>
                    </div>
                </div>
            `;
        }

        function renderStep2() {
            return `
                <div style="
                    background: hsl(0 0% 100%);
                    border: 1px solid hsl(214.3 31.8% 91.4%);
                    border-radius: 0.75rem;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    max-width: 32rem;
                    width: 90%;
                    text-align: center;
                    overflow: hidden;
                ">
                    <!-- Header -->
                    <div style="
                        padding: 1.5rem 2rem 1rem 2rem;
                        background: hsl(210 40% 98%);
                        border-bottom: 1px solid hsl(214.3 31.8% 91.4%);
                    ">
                        <div style="
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            width: 3rem;
                            height: 3rem;
                            border-radius: 50%;
                            background: hsl(222.2 84% 4.9%);
                            margin-bottom: 1rem;
                            color: white;
                            font-size: 24px;
                        ">
                            ${LUCIDE_ICONS.layers}
                        </div>
                        <h2 style="
                            color: hsl(222.2 84% 4.9%);
                            font-size: 1.5rem;
                            font-weight: 600;
                            margin: 0 0 0.5rem 0;
                            line-height: 1.2;
                        ">Help Build a Study Resource</h2>
                        <p style="
                            color: hsl(215.4 16.3% 46.9%);
                            font-size: 0.875rem;
                            margin: 0;
                            line-height: 1.5;
                        ">Would you like to contribute your quiz data to help other students?</p>
                    </div>
                    
                    <!-- Content -->
                    <div style="padding: 1.5rem 2rem;">
                        <p style="
                            color: hsl(215.4 16.3% 46.9%);
                            font-size: 0.8125rem;
                            line-height: 1.5;
                            margin: 0 0 1rem 0;
                            text-align: left;
                        ">When enabled, your captured quizzes will be anonymously shared when you view quiz results to help build a shared study resource.</p>
                        
                        <div style="
                            background: hsl(210 40% 98%);
                            border: 1px solid hsl(214.3 31.8% 91.4%);
                            border-radius: 0.5rem;
                            padding: 1rem;
                            margin-bottom: 1.5rem;
                            text-align: left;
                        ">
                            <div style="
                                display: flex;
                                flex-direction: column;
                                gap: 0.75rem;
                                font-size: 0.75rem;
                                line-height: 1.5;
                            ">
                                <div>
                                    <span style="color: hsl(222.2 84% 4.9%); font-weight: 600;">What's shared:</span>
                                    <span style="color: hsl(215.4 16.3% 46.9%);"> Quiz title, course name, questions, and answers.</span>
                                </div>
                                <div>
                                    <span style="color: hsl(222.2 84% 4.9%); font-weight: 600;">What's NOT shared:</span>
                                    <span style="color: hsl(215.4 16.3% 46.9%);"> Your name, email, or any personal information.</span>
                                </div>
                            </div>
                        </div>
                        <div style="
                            display: flex;
                            gap: 0.75rem;
                            justify-content: center;
                        ">
                            <button id="onboarding-decline-btn" style="
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                border-radius: 0.375rem;
                                font-size: 0.875rem;
                                font-weight: 500;
                                height: 2.5rem;
                                padding: 0 1.25rem;
                                background: transparent;
                                color: hsl(215.4 16.3% 46.9%);
                                border: 1px solid hsl(214.3 31.8% 91.4%);
                                cursor: pointer;
                                transition: all 0.2s;
                            " onmouseover="this.style.background='hsl(210 40% 98%)'" onmouseout="this.style.background='transparent'">
                                No thanks
                            </button>
                            <button id="onboarding-accept-btn" style="
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                gap: 0.375rem;
                                border-radius: 0.375rem;
                                font-size: 0.875rem;
                                font-weight: 500;
                                height: 2.5rem;
                                padding: 0 1.25rem;
                                background: hsl(222.2 84% 4.9%);
                                color: hsl(0 0% 100%);
                                border: none;
                                cursor: pointer;
                                transition: all 0.2s;
                            " onmouseover="this.style.background='hsl(222.2 84% 8%)'" onmouseout="this.style.background='hsl(222.2 84% 4.9%)'">
                                <span style="font-size: 16px; color: inherit; display: inline-flex;">${LUCIDE_ICONS.check}</span>
                                Yes
                            </button>
                        </div>
                        
                        <!-- Step indicators -->
                        <div style="
                            display: flex;
                            justify-content: center;
                            gap: 0.5rem;
                            margin-top: 1.25rem;
                        ">
                            <div style="
                                width: 0.5rem;
                                height: 0.5rem;
                                border-radius: 50%;
                                background: hsl(214.3 31.8% 91.4%);
                            "></div>
                            <div style="
                                width: 0.5rem;
                                height: 0.5rem;
                                border-radius: 50%;
                                background: hsl(222.2 84% 4.9%);
                            "></div>
                        </div>
                    </div>
                </div>
            `;
        }

        function completeOnboarding() {
            onboardingDiv.remove();
            safeLocalStorageSet(APPLICATION_CONFIG.userOnboarding.hasCompletedIntroduction, 'true');
            recordUserInteraction('onboarding_completed');
        }

        function updateContent() {
            if (currentStep === 1) {
                onboardingDiv.innerHTML = renderStep1();
                // Attach continue button handler
                const continueBtn = document.getElementById('onboarding-continue-btn');
                if (continueBtn) {
                    continueBtn.addEventListener('click', () => {
                        currentStep = 2;
                        updateContent();
                    });
                }
            } else {
                onboardingDiv.innerHTML = renderStep2();
                // Attach consent button handlers
                const declineBtn = document.getElementById('onboarding-decline-btn');
                const acceptBtn = document.getElementById('onboarding-accept-btn');
                
                if (declineBtn) {
                    declineBtn.addEventListener('click', () => {
                        setDataSharingConsent(false);
                        completeOnboarding();
                    });
                }
                if (acceptBtn) {
                    acceptBtn.addEventListener('click', () => {
                        setDataSharingConsent(true);
                        completeOnboarding();
                    });
                }
            }
        }

        document.body.appendChild(onboardingDiv);
        updateContent();
    }

    // ============== DATA SHARING / DISCORD WEBHOOK ==============

    // Check if user has consented to data sharing
    function hasDataSharingConsent() {
        return safeLocalStorageGet(APPLICATION_CONFIG.dataSharing.hasConsented) === 'true';
    }

    // Set data sharing consent
    function setDataSharingConsent(consented) {
        safeLocalStorageSet(APPLICATION_CONFIG.dataSharing.hasConsented, consented ? 'true' : 'false');
    }

    // Get user name from Canvas environment
    function getUserName() {
        try {
            if (typeof ENV !== 'undefined') {
                if (ENV.current_user && ENV.current_user.display_name) {
                    return ENV.current_user.display_name;
                }
                if (ENV.current_user && ENV.current_user.name) {
                    return ENV.current_user.name;
                }
                if (ENV.current_user_display_name) {
                    return ENV.current_user_display_name;
                }
            }
        } catch (e) {
        }

        try {
            const scripts = document.querySelectorAll('head script:not([src])');
            for (const script of scripts) {
                const text = script.textContent;
                if (text && (text.includes('INST') || text.includes('ENV')) && text.includes('display_name')) {
                    // Regex: "display_name":"<captured value>"
                    const match = text.match(/"display_name"\s*:\s*"([^"]+)"/);
                    if (match && match[1]) {
                        return match[1];
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing display_name from script tags:', e);
        }
        return '';
    }

    // Send quiz data to Discord webhook
    async function sendQuizToDiscordWebhook(containerElement, courseName, quizTitle) {
        try {
            const webhookUrl = APPLICATION_CONFIG.dataSharing.webhookUrl;
            if (!webhookUrl) {
                console.error('Discord webhook URL not configured');
                return false;
            }
            
            // Get contributor name if provided
            const contributorName = getUserName();
            
            // Generate HTML using the shared function (without search/quiz mode for simpler output)
            const htmlContent = await generateFullHtmlReport(containerElement, {
                courseName: courseName,
                quizTitle: quizTitle,
                includeSearch: false,
                includeQuizMode: false,
                contributorName: contributorName
            });
            
            if (!htmlContent) {
                return false;
            }
            
            // Count questions from the container
            const questionCards = containerElement.querySelectorAll('.question-card');
            const questionCount = questionCards.length;
            
            // Create filename
            const sanitizedCourse = (courseName || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
            const sanitizedQuiz = (quizTitle || 'Quiz').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
            const filename = `${sanitizedCourse}-${sanitizedQuiz}.html`;
            
            // Create form data with file
            const blob = new Blob([htmlContent], { type: 'text/html' });
            const formData = new FormData();
            formData.append('file', blob, filename);
            formData.append('payload_json', JSON.stringify({
                content: '**New Quiz Captured!**',
                embeds: [{
                    title: quizTitle || 'Untitled Quiz',
                    color: 0x3B82F6,
                    fields: [
                        { name: 'Course', value: courseName || 'Unknown', inline: true },
                        { name: 'Questions', value: questionCount.toString(), inline: true },
                        ...(contributorName ? [{ name: 'Contributor', value: contributorName, inline: true }] : [])
                    ],
                    footer: { text: 'QuizFetch Community Sharing' },
                    timestamp: new Date().toISOString()
                }]
            }));
            
            const response = await fetch(webhookUrl, {
                method: 'POST',
                body: formData
            });
            
            return response.ok;
        } catch (error) {
            console.error('Error sending to Discord webhook:', error);
            return false;
        }
    }

    // Track which quizzes have been shared to avoid duplicates
    function hasQuizBeenShared(courseId, quizKey) {
        const sharedKey = `quizfetch_shared_${courseId}_${quizKey}`;
        return safeLocalStorageGet(sharedKey) === 'true';
    }

    function markQuizAsShared(courseId, quizKey) {
        const sharedKey = `quizfetch_shared_${courseId}_${quizKey}`;
        safeLocalStorageSet(sharedKey, 'true');
    }

    // Main function to handle quiz sharing on results page
    async function handleQuizResultsPageSharing(containerElement, courseId, quizKey, courseName, quizTitle) {
        // Check if already shared
        if (hasQuizBeenShared(courseId, quizKey)) {
            return;
        }
        
        // Check consent - if not set yet, don't share (they'll be asked during onboarding)
        const consentStatus = safeLocalStorageGet(APPLICATION_CONFIG.dataSharing.hasConsented);
        
        if (consentStatus === 'true') {
            // User consented during onboarding - share automatically
       
        }
        // If consent is null or 'false', don't share and don't prompt
        const success = await sendQuizToDiscordWebhook(containerElement, courseName, quizTitle);
        if (success) {
            markQuizAsShared(courseId, quizKey);
        }
    }

    // Get total questions captured from localStorage
    function getTotalQuestionsFromStorage() {
        try {
            const storedData = safeLocalStorageGet('quizQuestions');
            if (!storedData) return 0;

            const questionsData = JSON.parse(storedData);
            let totalQuestions = 0;

            // Count all questions across all courses and quizzes
            for (const courseId in questionsData) {
                if (!questionsData[courseId] || typeof questionsData[courseId] !== 'object') continue;
                for (const quizKey in questionsData[courseId]) {
                    if (quizKey === 'courseName') continue;
                    const quizData = questionsData[courseId][quizKey];
                    if (quizData && quizData.questions && Array.isArray(quizData.questions)) {
                        totalQuestions += quizData.questions.length;
                    }
                }
            }

            return totalQuestions;
        } catch (error) {
            console.error('Error counting questions from storage:', error);
            return 0;
        }
    }

    // Update total questions count in analytics storage
    function updateTotalQuestionsCount() {
        try {
            const totalQuestions = getTotalQuestionsFromStorage();
            safeLocalStorageSet(APPLICATION_CONFIG.userAnalytics.totalQuestionsCollected, totalQuestions.toString());
        } catch (error) {
            console.error('Error updating total questions count:', error);
        }
    }

    // One-time migration to count existing questions in localStorage
    function migrateExistingQuestions() {
        try {
            // Check if migration has already been run
            const migrationCompleted = safeLocalStorageGet(APPLICATION_CONFIG.userAnalytics.hasRunInitialMigration);
            if (migrationCompleted === 'true') {
                return;
            }

            const storedData = safeLocalStorageGet('quizQuestions');
            if (!storedData) {
                safeLocalStorageSet(APPLICATION_CONFIG.userAnalytics.hasRunInitialMigration, 'true');
                return;
            }

            const questionsData = JSON.parse(storedData);
            let totalExistingQuestions = 0;
            const migrationDate = new Date().toISOString().split('T')[0];

            // Count all existing questions and simulate capture events
            for (const courseId in questionsData) {
                for (const quizKey in questionsData[courseId]) {
                    if (questionsData[courseId][quizKey].questions) {
                        const questionsCount = questionsData[courseId][quizKey].questions.length;
                        totalExistingQuestions += questionsCount;

                        // Record these as captured questions in analytics for the migration date
                        const existingUsageData = JSON.parse(safeLocalStorageGet(APPLICATION_CONFIG.userAnalytics.dailyUsageMetrics) || '{}');

                        if (!existingUsageData[migrationDate]) {
                            existingUsageData[migrationDate] = {};
                        }

                        if (!existingUsageData[migrationDate]['questions_migrated']) {
                            existingUsageData[migrationDate]['questions_migrated'] = 0;
                        }

                        existingUsageData[migrationDate]['questions_migrated'] += questionsCount;
                        safeLocalStorageSet(APPLICATION_CONFIG.userAnalytics.dailyUsageMetrics, JSON.stringify(existingUsageData));

                        // Track the course if not already tracked
                        const enrolledCourses = JSON.parse(safeLocalStorageGet(APPLICATION_CONFIG.userAnalytics.enrolledCoursesTracked) || '[]');
                        if (!enrolledCourses.includes(courseId)) {
                            enrolledCourses.push(courseId);
                            safeLocalStorageSet(APPLICATION_CONFIG.userAnalytics.enrolledCoursesTracked, JSON.stringify(enrolledCourses));
                        }
                    }
                }
            }

            // Update total questions count
            safeLocalStorageSet(APPLICATION_CONFIG.userAnalytics.totalQuestionsCollected, totalExistingQuestions.toString());

            // Mark migration as completed
            safeLocalStorageSet(APPLICATION_CONFIG.userAnalytics.hasRunInitialMigration, 'true');


        } catch (error) {
            console.error('Error during question migration:', error);
            // Mark as completed even if there was an error to prevent infinite retries
            safeLocalStorageSet(APPLICATION_CONFIG.userAnalytics.hasRunInitialMigration, 'true');
        }
    }

    // One-time migration to add history metadata to existing quiz entries
    function migrateHistoryMetadata() {
        try {
            // Check if migration has already been run
            const migrationCompleted = safeLocalStorageGet(APPLICATION_CONFIG.historyMigration.hasRunHistoryMetadataMigration);
            if (migrationCompleted === 'true') {
                return;
            }

            const storedData = safeLocalStorageGet('quizQuestions');
            if (!storedData) {
                safeLocalStorageSet(APPLICATION_CONFIG.historyMigration.hasRunHistoryMetadataMigration, 'true');
                return;
            }

            const questionsData = JSON.parse(storedData);
            const migrationTimestamp = new Date().toISOString();
            let migratedCount = 0;

            // Iterate through all courses and quizzes to add missing metadata
            for (const courseId in questionsData) {
                if (!questionsData.hasOwnProperty(courseId)) continue;
                
                const courseData = questionsData[courseId];
                
                // Add courseName if missing at course level
                if (typeof courseData === 'object' && !courseData.courseName) {
                    courseData.courseName = null; // Will be populated when user visits the page
                }

                for (const quizKey in courseData) {
                    if (!courseData.hasOwnProperty(quizKey) || quizKey === 'courseName') continue;
                    
                    const quiz = courseData[quizKey];
                    if (!quiz || typeof quiz !== 'object') continue;

                    // Add missing metadata fields
                    let wasUpdated = false;

                    if (!quiz.firstCapturedAt) {
                        quiz.firstCapturedAt = migrationTimestamp;
                        wasUpdated = true;
                    }

                    if (!quiz.lastUpdatedAt) {
                        quiz.lastUpdatedAt = migrationTimestamp;
                        wasUpdated = true;
                    }

                    if (!quiz.quizTitle) {
                        quiz.quizTitle = null; // Will be populated when user visits the page
                        wasUpdated = true;
                    }

                    if (wasUpdated) {
                        migratedCount++;
                    }
                }
            }

            // Save the updated data back to localStorage
            safeLocalStorageSet('quizQuestions', JSON.stringify(questionsData));

            // Mark migration as completed
            safeLocalStorageSet(APPLICATION_CONFIG.historyMigration.hasRunHistoryMetadataMigration, 'true');


        } catch (error) {
            console.error('Error during history metadata migration:', error);
            // Mark as completed even if there was an error to prevent infinite retries
            safeLocalStorageSet(APPLICATION_CONFIG.historyMigration.hasRunHistoryMetadataMigration, 'true');
        }
    }

    // Record user interactions and analytics data
    function recordUserInteraction(eventName, additionalData = {}) {
        try {
            const currentDate = new Date().toISOString().split('T')[0];
            const existingUsageData = JSON.parse(safeLocalStorageGet(APPLICATION_CONFIG.userAnalytics.dailyUsageMetrics) || '{}');

            if (!existingUsageData[currentDate]) {
                existingUsageData[currentDate] = {};
            }

            if (!existingUsageData[currentDate][eventName]) {
                existingUsageData[currentDate][eventName] = 0;
            }

            existingUsageData[currentDate][eventName]++;
            safeLocalStorageSet(APPLICATION_CONFIG.userAnalytics.dailyUsageMetrics, JSON.stringify(existingUsageData));

            // Record course enrollment data if provided
            if (additionalData.courseId) {
                const enrolledCourses = JSON.parse(safeLocalStorageGet(APPLICATION_CONFIG.userAnalytics.enrolledCoursesTracked) || '[]');
                if (!enrolledCourses.includes(additionalData.courseId)) {
                    enrolledCourses.push(additionalData.courseId);
                    safeLocalStorageSet(APPLICATION_CONFIG.userAnalytics.enrolledCoursesTracked, JSON.stringify(enrolledCourses));
                }
            }

            // Update total questions count when capturing questions
            if (eventName === 'question_captured') {
                updateTotalQuestionsCount();
            }
        } catch (error) {
            console.error('User interaction recording error:', error);
        }
    }

    // Add feedback button to popup
    function addFeedbackButton(container) {
        const feedbackBtn = document.createElement('button');
        feedbackBtn.innerHTML = `${LUCIDE_ICONS.barChart} Feedback`;
        feedbackBtn.style.cssText = `
            position: absolute; 
            top: 10px; 
            right: 60px;
            display: inline-flex;
            align-items: center;
            gap: 0.375rem;
            background: hsl(0 0% 100%);
            color: hsl(222.2 84% 4.9%);
            border: 1px solid hsl(214.3 31.8% 91.4%);
            padding: 0.375rem 0.75rem;
            border-radius: 0.375rem;
            cursor: pointer;
            font-size: 0.8125rem;
            font-weight: 500;
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
            transition: all 0.2s;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        `;

        // Add hover effects
        feedbackBtn.addEventListener('mouseenter', function () {
            this.style.background = 'hsl(210 40% 98%)';
            this.style.borderColor = 'hsl(214.3 31.8% 86.4%)';
        });

        feedbackBtn.addEventListener('mouseleave', function () {
            this.style.background = 'hsl(0 0% 100%)';
            this.style.borderColor = 'hsl(214.3 31.8% 91.4%)';
        });

        feedbackBtn.addEventListener('click', function () {
            const userFeedback = prompt('How can we improve QuizFetch? Your feedback helps us build better features!');
            if (userFeedback) {
                recordUserInteraction('feedback_submitted', { feedbackLength: userFeedback.length });
                alert('Thank you for your feedback! 🙏');
            }
        });

        container.appendChild(feedbackBtn);
    }

    // ============== MESSAGE TYPES FOR POPUP COMMUNICATION ==============
    const MESSAGE_TYPES = {
        DEBUG: 'quiz-fetch-debug',
        PING: 'quiz-fetch-ping',
        PONG: 'quiz-fetch-pong',
        GET_HISTORY: 'quiz-fetch-get-history',
        GET_STATS: 'quiz-fetch-get-stats',
        EXPORT_DATA: 'quiz-fetch-export-data',
        IMPORT_DATA: 'quiz-fetch-import-data'
    };

    // Listen for messages from the popup
    if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
        browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
            try {
                if (message.type === MESSAGE_TYPES.PING) {
                    return Promise.resolve(MESSAGE_TYPES.PONG);
                }
                
                if (message.type === MESSAGE_TYPES.DEBUG) {
                    // Return debug logs
                    const logs = [];
                    logs.push('QuizFetch Debug Information');
                    logs.push('===========================');
                    logs.push(`URL: ${window.location.href}`);
                    logs.push(`Timestamp: ${new Date().toISOString()}`);
                    
                    const storedData = safeLocalStorageGet('quizQuestions');
                    if (storedData) {
                        const parsed = JSON.parse(storedData);
                        logs.push(`Stored courses: ${Object.keys(parsed).length}`);
                        let totalQuizzes = 0;
                        let totalQuestions = 0;
                        for (const courseId in parsed) {
                            for (const quizKey in parsed[courseId]) {
                                if (quizKey === 'courseName') continue;
                                totalQuizzes++;
                                if (parsed[courseId][quizKey].questions) {
                                    totalQuestions += parsed[courseId][quizKey].questions.length;
                                }
                            }
                        }
                        logs.push(`Total quizzes: ${totalQuizzes}`);
                        logs.push(`Total questions: ${totalQuestions}`);
                    } else {
                        logs.push('No stored quiz data found');
                    }

                    logs.push('');
                    logs.push('=== Captured Console Logs ===');
                    if (debugLogBuffer.length === 0) {
                        logs.push('(No logs captured yet)');
                    } else {
                        debugLogBuffer.forEach(entry => {
                            logs.push(`[${entry.timestamp}] [${entry.level}] ${entry.message}`);
                        });
                    }

                    return Promise.resolve(logs.join('\n'));
                }
                
                if (message.type === MESSAGE_TYPES.GET_HISTORY) {
                    const historyData = getQuizHistoryData();
                    return Promise.resolve(historyData);
                }
                
                if (message.type === MESSAGE_TYPES.GET_STATS) {
                    const historyData = getQuizHistoryData();
                    const totalQuizzes = historyData.length;
                    const totalQuestions = historyData.reduce((sum, quiz) => sum + quiz.questionCount, 0);
                    const courseCount = new Set(historyData.map(q => q.courseId)).size;
                    
                    // Get recent quizzes (last 5)
                    const recentQuizzes = sortQuizzesByDate(historyData, 'desc').slice(0, 5);
                    
                    return Promise.resolve({
                        totalQuizzes,
                        totalQuestions,
                        courseCount,
                        recentQuizzes
                    });
                }
                
                if (message.type === MESSAGE_TYPES.EXPORT_DATA) {
                    // Export quiz data and all quizfetch_ prefixed localStorage items
                    const exportData = {};
                    
                    // First, get the main quizQuestions data
                    const quizQuestionsData = safeLocalStorageGet('quizQuestions');
                    if (quizQuestionsData) {
                        try {
                            exportData['quizQuestions'] = JSON.parse(quizQuestionsData);
                        } catch {
                            exportData['quizQuestions'] = quizQuestionsData;
                        }
                    }
                    
                    // Then get all quizfetch_ prefixed items (analytics, settings, etc.)
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key && key.startsWith('quizfetch_')) {
                            try {
                                const value = localStorage.getItem(key);
                                try {
                                    exportData[key] = JSON.parse(value);
                                } catch {
                                    exportData[key] = value;
                                }
                            } catch (err) {
                                console.error(`Error reading key ${key}:`, err);
                            }
                        }
                    }
                    return Promise.resolve(exportData);
                }
                
                if (message.type === MESSAGE_TYPES.IMPORT_DATA) {
                    // Import data into localStorage
                    const importData = message.data;
                    let importedCount = 0;
                    
                    if (typeof importData === 'object' && importData !== null) {
                        for (const [key, value] of Object.entries(importData)) {
                            // Allow quizQuestions key or any quizfetch_ prefixed key
                            if (key === 'quizQuestions' || key.startsWith('quizfetch_')) {
                                try {
                                    const valueToStore = typeof value === 'string' ? value : JSON.stringify(value);
                                    localStorage.setItem(key, valueToStore);
                                    importedCount++;
                                } catch (err) {
                                    console.error(`Error importing key ${key}:`, err);
                                }
                            }
                        }
                    }
                    return Promise.resolve({ success: true, count: importedCount });
                }
                
                return false;
            } catch (error) {
                console.error('Error handling message:', error);
                return Promise.resolve({ error: error.message });
            }
        });
    }
})();
