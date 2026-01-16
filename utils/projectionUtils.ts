import type { SketchState, Feature } from '../types';

/**
 * Detects if a sketch contains projected construction geometry from a face.
 * Returns true if there are any points or lines with p_proj_* or l_proj_* IDs.
 */
export function hasProjectedGeometry(sketch: SketchState): boolean {
  const hasProjectedPoints = sketch.points.some(p => p.id.startsWith('p_proj_'));
  const hasProjectedLines = sketch.lines.some(l => l.id.startsWith('l_proj_'));
  return hasProjectedPoints || hasProjectedLines;
}

/**
 * Counts the number of projected elements in a sketch
 */
export function countProjectedElements(sketch: SketchState): { points: number; lines: number } {
  const points = sketch.points.filter(p => p.id.startsWith('p_proj_')).length;
  const lines = sketch.lines.filter(l => l.id.startsWith('l_proj_')).length;
  return { points, lines };
}

/**
 * Determines if a feature should show a warning about outdated projected lines.
 * A warning is shown if:
 * 1. The feature has projected geometry (imported face edges)
 * 2. It explicitly depends on a parent feature (via parentFeatureId)
 * 3. That parent feature has been modified after this feature's projection was last updated
 */
export function shouldShowProjectionWarning(feature: Feature, allFeatures: Feature[]): boolean {
  // Must have projected geometry
  if (!hasProjectedGeometry(feature.sketch)) {
    return false;
  }
  
  // If we have explicit parent tracking, check that specific parent
  if (feature.parentFeatureId) {
    const parent = allFeatures.find(f => f.id === feature.parentFeatureId);
    if (!parent) {
      // Parent deleted? That's definitely a warning state (or "orphaned")
      return true; 
    }
    
    // Compare parent modification time to this feature's PROJECTION update time
    // If projectionLastUpdated is missing, fallback to feature.lastModified
    const lastUpdate = feature.projectionLastUpdated || feature.lastModified;
    return parent.lastModified > lastUpdate;
  }

  // Fallback behavior for legacy features: Check if *any* earlier feature changed
  const featureIndex = allFeatures.findIndex(f => f.id === feature.id);
  if (featureIndex === -1) return false;
  
  const previousFeatures = allFeatures.slice(0, featureIndex);
  
  return previousFeatures.some(prevFeature => 
    prevFeature.lastModified > feature.lastModified
  );
}
