/**
 * QuizFetch Storage Module
 * Contains localStorage helper functions with error handling
 */
(function() {
    'use strict';

    // Safely store data to localStorage with error handling
    window.quizfetchStorage = {
        set: function(key, value) {
            try {
                localStorage.setItem(key, value);
                return true;
            } catch (error) {
                console.error('Error storing data to localStorage:', error);
                return false;
            }
        },

        get: function(key) {
            try {
                return localStorage.getItem(key);
            } catch (error) {
                console.error('Error retrieving data from localStorage:', error);
                return null;
            }
        },

        remove: function(key) {
            try {
                localStorage.removeItem(key);
                return true;
            } catch (error) {
                console.error('Error removing data from localStorage:', error);
                return false;
            }
        },

        setJSON: function(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (error) {
                console.error('Error storing JSON to localStorage:', error);
                return false;
            }
        },

        getJSON: function(key) {
            try {
                const value = localStorage.getItem(key);
                return value ? JSON.parse(value) : null;
            } catch (error) {
                console.error('Error retrieving JSON from localStorage:', error);
                return null;
            }
        }
    };

    // Legacy function aliases for backward compatibility
    window.safeLocalStorageSet = window.quizfetchStorage.set;
    window.safeLocalStorageGet = window.quizfetchStorage.get;
})();
