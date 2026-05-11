// Preload scripts run in a privileged context with access to Node.js APIs
// and a limited subset of Electron APIs. They run before the renderer's
// web content loads.
//
// In Vigil, this file will expose a typed IPC bridge to the renderer
// (see ARCHITECTURE.md § 4 and the future ADR on IPC contract).
//
// For now it is intentionally empty — the smoke window renders without
// needing any preload-exposed APIs.

export {};
