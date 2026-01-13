# AGENTS.md - Estrudo Development Standards

This document serves as the standard operating procedure for AI agents working on the Estrudo repository.

## Project Overview
Estrudo is a parametric CAD application built with React and Three.js, utilizing Replicad (OpenCascade WASM) for its geometry engine. It supports 2D sketching with constraints and 3D feature generation (Extrude/Revolve) with boolean operations.

## Commands
- **Development**: `npm run dev` - Starts the Vite development server.
- **Build**: `npm run build` - Builds the application for production.
- **Preview**: `npm run preview` - Previews the production build.
- **Lint/Test**: Currently, no formal linting or testing suite is configured in `package.json`. Rely on TypeScript compilation for type safety.

## Code Style & Guidelines

### 1. Types & Structure
- **Strict Typing**: Use TypeScript for all new code. Refer to `types.ts` for core data structures (`SketchState`, `Feature`, `Constraint`).
- **Interfaces over Types**: Prefer `interface` for object definitions and `type` for unions or aliases.
- **Naming Conventions**:
  - Components: `PascalCase` (e.g., `ThreeView.tsx`)
  - Variables/Functions: `camelCase` (e.g., `generateGeometryForFeatureReplicad`)
  - Files: Match the primary export (e.g., `useHistoryCSG.ts` for the hook).

### 2. React Patterns
- **Hooks**: Use `useCallback` and `useMemo` extensively to prevent unnecessary re-renders in the 3D pipeline.
- **Refs**: Use `useRef` for THREE.js objects (Groups, Scenes, Renderers) to maintain state outside the React render cycle.
- **State Management**: The application uses local React state; be mindful of prop-drilling in complex components like `ThreeView`.

### 3. Geometry Engine (Replicad + THREE.js)
- **The Pipeline**: `SketchState` -> `Replicad Drawing` -> `Replicad Shape` -> `THREE.BufferGeometry`.
- **Performance**:
  - **Previews**: Use a high tolerance (`2.0`) and angular tolerance (`0.8`) for real-time updates (see `sketchGeometry.ts`).
  - **Export**: Use high precision (`0.1` tolerance) only when requested (e.g., STL export).
  - **Debouncing**: Debounce geometry generation (e.g., 300ms) during user interactions like slider dragging.
- **Boolean Operations**: Replicad handles `fuse` (Add) and `cut` (Subtract). Ensure profiles do not cross revolution axes.
- **Transformations**: Sketches on faces use a 16-element Matrix4 array (`feature.transform`) to map local 2D coordinates to 3D world space.

### 4. Imports & Dependencies
- **THREE.js**: Import as `import * as THREE from "three"`.
- **Replicad**: Initialize via `initReplicad()` from `services/replicad.ts` before use. Note that Replicad uses Top-level await support (configured in Vite).
- **Paths**: Use absolute paths for file system tools and clear relative paths for imports.

### 5. Error Handling
- **WASM Initialization**: Always `await initReplicad()` in async geometry functions.
- **Geometry Failures**: Wrap Replicad operations (especially boolean cuts) in `try/catch`. Log descriptive errors if a profile crosses an axis or a boolean operation fails.
- **Loading States**: Use the loading indicators in `Overlay.tsx` when performing expensive geometry calculations.

## Project Context
- **Constraint Solver**: Located in `services/constraintSolver.ts`. It handles the 2D parametric logic.
- **Feature History**: `useHistoryCSG.ts` manages the persistent tree of CAD features, applying boolean operations sequentially.
- **Sketching**: `sketchGeometry.ts` converts the 2D sketch state into Replicad drawings and THREE.js shapes.

## Agent Instructions
When working on this repository, always:
1. Read relevant context files (`types.ts`, `sketchGeometry.ts`, `useHistoryCSG.ts`) before proposing changes.
2. Verify that your changes maintain the performance of the 3D preview.
3. Ensure compatibility with the Replicad WASM environment.
4. Adhere to the established 2D-to-3D transformation patterns.
