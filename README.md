# Estrudo

**[Live Demo](https://sandrotaje.github.io/estrudo/)**

A web-based parametric CAD sketcher with real-time 3D visualization. Create precise 2D sketches with geometric constraints and transform them into 3D models using extrusion and revolve operations.

## Features

### 2D Sketching
- **Drawing Tools**: Points, lines, rectangles, circles, and arcs
- **Parametric Constraints**:
  - Geometric: Horizontal, vertical, parallel, tangent, coincident, midpoint
  - Dimensional: Distance, angle, radius, equal length
  - Fixed points for absolute positioning
- **Constraint Solver**: Real-time geometric constraint satisfaction using WASM-based solver

### 3D Operations
- **Extrude**: Convert 2D sketches into 3D solids with configurable depth
- **Revolve**: Create rotational features around a sketch axis
- **CSG Operations**:
  - Additive (NEW) - create new solid bodies
  - Subtractive (CUT) - remove material from existing bodies
- **Feature History**: Manage and edit multiple features with non-destructive workflow

### Visualization
- **Real-time 3D Preview**: Interactive Three.js-based viewport
- **Face Highlighting**: Visual feedback for face selection
- **Sketch Overlays**: See your 2D sketch projected in 3D space
- **Axis Visualization**: Orient yourself in 3D space

## Getting Started

### Prerequisites
- Node.js (v18 or higher)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/sandrotaje/estrudo.git
   cd estrudo
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:3000`

### Building for Production

```bash
npm run build
```

The production-ready files will be generated in the `dist` directory.

## Usage

### Creating a Sketch
1. Select a drawing tool from the toolbar (LINE, RECTANGLE, CIRCLE, ARC)
2. Click on the canvas to place points and create geometry
3. Use the SELECT tool to select elements

### Applying Constraints
1. Select one or more sketch elements
2. Choose a constraint from the floating constraints panel
3. For dimensional constraints (distance, angle, radius), enter the desired value
4. The sketch will update automatically to satisfy all constraints

### Creating 3D Features
1. Complete your 2D sketch
2. Select the feature type (EXTRUDE or REVOLVE)
3. Configure the operation parameters:
   - **Extrude**: Set the extrusion depth
   - **Revolve**: Choose the axis line and rotation angle
4. Choose the operation type (NEW or CUT)
5. Execute the feature to see the 3D result

### Managing Features
- View all features in the sidebar
- Edit feature parameters by selecting them
- Features are applied in order, creating a history-based workflow

## Technology Stack

- **React 19**: Modern UI framework
- **TypeScript**: Type-safe development
- **Three.js**: 3D rendering and visualization
- **Replicad**: Geometry engine built on OpenCascade (the same kernel powering FreeCAD), compiled to WASM for browser-based B-Rep modeling and boolean operations
- **Vite**: Fast build tool and development server

## Project Structure

```
estrudo/
├── components/
│   ├── SketchCanvas.tsx        # 2D sketching interface
│   ├── ThreeView/              # 3D visualization components
│   ├── Sidebar.tsx             # Feature management panel
│   ├── Toolbar.tsx             # Drawing tools
│   └── FloatingConstraints.tsx # Constraint application UI
├── services/
│   ├── constraintSolver.ts     # Geometric constraint solver
│   └── wasmSolver.ts          # WASM solver interface
├── types.ts                    # TypeScript type definitions
├── App.tsx                     # Main application component
└── vite.config.ts             # Build configuration
```

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally

### GitHub Pages Deployment

The project uses GitHub Actions to automatically deploy to GitHub Pages on every commit to the main branch. The workflow:
1. Builds the application
2. Uploads the build artifacts
3. Deploys to GitHub Pages

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is private and not licensed for public use.

## Acknowledgments

Built with modern web technologies for high-performance parametric CAD modeling in the browser.
