# Frontend route map

| Route | Purpose | Live data source |
|---|---|---|
| `/` | Product introduction and interactive shell | Shell verification requires `project==version`; backend release discovery then verification |
| `/verify` | Verify one exact artifact and inspect evidence | `GET /api/v1/packages/{project}/{version}/files`, `POST /api/v1/verify` |
| `/packages` | Open a package dossier | Enter `project==version`; demo fixtures remain opt-in |
| `/packages/[package]` | One exact release’s metadata, artifact list and session evidence | Exact release GET; verification only appears after a verify workflow |
| `/compare` | Compare two exact releases and optionally request archive inventories | Two exact release GETs; inventory uses `POST /api/v1/verify` for each selected artifact |
| `/provenance` | Inspect verification chain and run the distinct source-trace workflow | Exact release GET, `POST /api/v1/verify`, optional `POST /api/v1/source-trace` |
| `/architecture` | Pipeline and trust boundaries | Documentation |
| `/docs` | Methodology, status semantics and limitations | Documentation |
