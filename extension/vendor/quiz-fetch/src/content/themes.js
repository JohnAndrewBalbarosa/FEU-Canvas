/**
 * QuizFetch Themes Module
 * Contains theme configuration (light mode)
 */
(function() {
    'use strict';

    window.QUIZFETCH_THEMES = {
        light: {
            name: 'light',
            popup: {
                background: 'rgba(255, 253, 252, 0.44)',
                backdropFilter: 'blur(20px) saturate(1.65) brightness(1.03)',
                border: 'rgba(255, 255, 255, 0.62)',
                shadow: '0 32px 80px rgba(0, 0, 0, 0.20), 0 8px 24px rgba(0, 0, 0, 0.11), 0 2px 6px rgba(0, 0, 0, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.82), inset 0 -1px 0 rgba(0, 0, 0, 0.04)'
            },
            header: {
                background: 'rgba(255, 253, 252, 0.68)',
                border: 'rgba(255, 255, 255, 0.42)'
            },
            text: {
                primary: 'hsl(222.2 84% 4.9%)',
                secondary: 'hsl(215.4 16.3% 46.9%)',
                muted: 'hsl(215.4 16.3% 60%)'
            },
            tab: {
                inactive: 'hsl(215.4 16.3% 46.9%)',
                active: 'hsl(222.2 84% 4.9%)',
                activeBorder: 'hsl(222.2 47.4% 11.2%)'
            },
            button: {
                background: 'rgba(255, 255, 255, 0.36)',
                backgroundHover: 'rgba(255, 255, 255, 0.58)',
                text: 'hsl(222.2 84% 4.9%)',
                border: 'rgba(255, 255, 255, 0.52)',
                primaryBg: 'rgba(30, 41, 59, 0.72)',
                primaryText: 'hsl(210 40% 98%)',
                primaryHover: 'rgba(30, 41, 59, 0.88)'
            },
            card: {
                background: 'rgba(255, 255, 255, 0.36)',
                backgroundHover: 'rgba(255, 255, 255, 0.56)',
                border: 'rgba(255, 255, 255, 0.52)',
                shadow: '0 4px 16px rgba(0, 0, 0, 0.07), 0 1px 4px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.72)'
            },
            input: {
                background: 'rgba(255, 255, 255, 0.6)',
                border: 'rgba(0, 0, 0, 0.1)',
                text: 'hsl(222.2 84% 4.9%)',
                placeholder: 'hsl(215.4 16.3% 46.9%)'
            },
            status: {
                correct: { bg: 'rgba(220, 252, 231, 0.4)', text: '#166534', border: 'rgba(187, 247, 208, 0.5)' },
                incorrect: { bg: 'rgba(254, 226, 226, 0.4)', text: '#dc2626', border: 'rgba(254, 202, 202, 0.5)' },
                neutral: { bg: 'rgba(249, 250, 251, 0.4)', text: '#6b7280', border: 'rgba(229, 231, 235, 0.5)' }
            },
            score: {
                excellent: { bg: 'hsl(142.1 70.6% 45.3% / 0.1)', text: 'hsl(142.1 76.2% 30%)' },
                good: { bg: 'hsl(45.4 93.4% 47.5% / 0.1)', text: 'hsl(45.4 93.4% 30%)' },
                poor: { bg: 'hsl(0 84.2% 60.2% / 0.1)', text: 'hsl(0 84.2% 40%)' },
                bar: '#000000'
            }
        }
    };
})();
