# Changelog

## [0.0.2] - 2026-09-23

### Fixed
- Automatic road, power, and clearing helpers now use correct building footprints, recognize power flags, and report failed connections and partial costs.
- Buildable suggestions match the engine's placement coordinates, and tool costs match actual funds spent.
- Batch results distinguish successful, failed, and skipped placements; MCP guidance explains safe retries and automatic connections.

### Changed
- Increased available API-key capacity from 500 to 2,000 while retaining existing per-IP limits.

### Added
- Sanitized request telemetry and detailed action outcomes for future usage audits.
- Local API smoke checks.
