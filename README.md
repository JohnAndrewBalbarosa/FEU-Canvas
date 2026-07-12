# FEU-Canvas

## Overview

Chrome extension companion for FEU Canvas: pending-work dashboards, discussion automation, quiz utilities

Repository: [JohnAndrewBalbarosa/FEU-Canvas](https://github.com/JohnAndrewBalbarosa/FEU-Canvas)

## Problem and Goal

**Problem.** Canvas coursework requires repeated navigation across pending work, discussions, and quiz utilities, making status review fragmented.

**Goal.** Provide a browser-extension companion that summarizes pending work and offers bounded utilities inside the user’s own FEU Canvas session.

## System Design

- `extension/manifest.json`: browser-extension permissions and entry points.
- `canvas-dashboard.js`: pending-work dashboard behavior.
- `canvas-blockers.js`: page-level guards and supported Canvas interactions.
- No package-managed build step is present; the extension runs from committed browser assets.

## Setup and Usage

```bash
# Chrome/Edge
# 1. Open the browser extensions page
# 2. Enable Developer mode
# 3. Choose Load unpacked
# 4. Select the extension/ directory
# 5. Open FEU Canvas in the same browser profile
```

## Evaluation Method

- Define the project task and expected behavior.
- Run representative examples or user flows.
- Record correctness, speed, reliability, usability, and failure cases.

## Results

- No validated quantitative results are published yet.
- Current README status: implementation and usage are documented before formal measurement.

## Interpretation

- The project can be described as implemented or in progress, but impact claims should stay limited until measurements are collected.
- Use the evaluation plan below to turn the project into resume-ready, evidence-backed work.

## Limitations

- Results should only be treated as validated when this README includes the dataset, sample size, metric definition, and reproduction steps.
- Any AI-generated, OCR-based, scraped, or heuristic output requires manual review before being used as ground truth.
- Environment-dependent measurements such as latency, memory use, browser behavior, and API reliability should be re-measured on the target machine.

## Recommendations and Future Work

- Add a small benchmark or validation dataset.
- Report sample size, success rate, error rate, and runtime where applicable.
- Add screenshots, logs, or exported reports that support the measured results.

## Documentation Standard

This README follows a technical-project structure: overview, goal, system design, setup, evaluation method, results, interpretation, limitations, and recommendations. Update the Results section whenever new measurements are available so project claims stay evidence-backed.
