# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- Removed cost display from the session header and sidebar in the TUI.
- Removed `ownCost` and `totalCost` from the session context tab.
- Removed cost tooltips and display from session context usage.
- Removed cost display from message parts in the UI.
- Cleaned up unused i18n keys related to costs (`context.stats.ownCost`, `context.stats.totalCost`, `context.stats.costBreakdown`, `context.usage.cost`, `ui.messagePart.costBreakdown`).
- Removed `costBreakdown` utility function.
