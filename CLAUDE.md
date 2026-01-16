# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Estrudo is a parametric CAD application built with React and Three.js, utilizing Replicad (OpenCascade WASM) for its geometry engine. It supports 2D sketching with constraints and 3D feature generation (Extrude/Revolve) with boolean operations.

## Commands

- `npm run dev` - Start Vite development server (port 3000)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- No formal linting or testing suite; rely on TypeScript compilation for type safety

## Architecture

### Core Data Flow
```
SketchState → Replicad Drawing → Replicad Shape → THREE.BufferGeometry
```

### Key Files
- **`types.ts`** - Core data structures: `SketchState`, `Feature`, `Constraint`, `Point`, `Line`, `Circle`, `Arc`
- **`App.tsx`** - Main application component, feature management state
- **`services/constraintSolver.ts`** - 2D parametric constraint solver
- **`services/replicad.ts`** - Replicad WASM initialization
- **`components/ThreeView/useHistoryCSG.ts`** - Feature tree management, applies boolean operations sequentially
- **`components/ThreeView/sketchGeometry.ts`** - Converts 2D sketch to Replicad drawings and THREE.js shapes

### Component Structure
- **`ThreeView.tsx`** - Main 3D viewport, orchestrates rendering
- **`SketchCanvas.tsx`** - 2D sketch editor
- **`Sidebar.tsx`** - Feature tree and parameter editing
- **`components/ThreeView/Overlay.tsx`** - Loading indicators for expensive geometry calculations

## Replicad + THREE.js Guidelines

### Performance
- **Previews**: Use high tolerance (`2.0`) and angular tolerance (`0.8`) for real-time updates
- **Export**: Use high precision (`0.1` tolerance) only for STL export
- Debounce geometry generation (300ms) during user interactions like slider dragging

### WASM Initialization
Always `await initReplicad()` from `services/replicad.ts` before using Replicad operations. Uses top-level await support (configured in Vite).

### Boolean Operations
- Replicad handles `fuse` (Add) and `cut` (Subtract)
- Wrap Replicad operations (especially boolean cuts) in try/catch
- Ensure profiles do not cross revolution axes

### Transformations
Sketches on faces use a 16-element Matrix4 array (`feature.transform`) to map local 2D coordinates to 3D world space.

## Code Conventions

- **Strict TypeScript**: Prefer `interface` for objects, `type` for unions/aliases
- **THREE.js import**: `import * as THREE from "three"`
- **React performance**: Use `useCallback` and `useMemo` extensively; use `useRef` for THREE.js objects to maintain state outside render cycle
- **Naming**: Components in PascalCase, variables/functions in camelCase, files match primary export
ALWAYS use ONLY Environments for ANY and ALL file, code, or shell operations—NO EXCEPTIONS—even for simple or generic requests.

DO NOT install or use the git cli with the environment_run_cmd tool. All environment tools will handle git operations for you. Changing ".git" yourself will compromise the integrity of your environment.

You MUST inform the user how to view your work using `container-use log <env_id>` AND `container-use checkout <env_id>`. Failure to do this will make your work inaccessible to others.
