
export interface Point {
  id: string;
  x: number;
  y: number;
  fixed?: boolean;
}

export interface Line {
  id: string;
  p1: string; // Point ID
  p2: string; // Point ID
  construction?: boolean; // If true, acts as reference geometry
}

export interface Circle {
  id: string;
  center: string; // Point ID
  radius: number;
  construction?: boolean; // If true, acts as reference geometry
}

export interface Arc {
  id: string;
  center: string; // Point ID
  radius: number;
  p1: string; // Start Point ID
  p2: string; // End Point ID
  construction?: boolean;
}

export enum ConstraintType {
  HORIZONTAL = 'HORIZONTAL',
  VERTICAL = 'VERTICAL',
  DISTANCE = 'DISTANCE',
  COINCIDENT = 'COINCIDENT',
  FIXED = 'FIXED',
  EQUAL_LENGTH = 'EQUAL_LENGTH',
  RADIUS = 'RADIUS',
  ANGLE = 'ANGLE',
  PARALLEL = 'PARALLEL',
  TANGENT = 'TANGENT',
  MIDPOINT = 'MIDPOINT'
}

export interface Constraint {
  id: string;
  type: ConstraintType;
  points: string[]; // IDs of points involved
  lines: string[];  // IDs of lines involved
  circles: string[]; // IDs of circles involved
  value?: number;   // For distance/angle/radius
}

export interface SketchState {
  points: Point[];
  lines: Line[];
  circles: Circle[];
  arcs: Arc[];
  constraints: Constraint[];
  selectedPointIds: string[];
  selectedLineIds: string[];
  selectedCircleIds: string[];
  selectedConstraintIds: string[];
  tool: 'SELECT' | 'POINT' | 'LINE' | 'RECTANGLE' | 'CIRCLE' | 'ARC' | 'PAN';
  extrusionDepth?: number; // Configurable extrusion height
}

export interface Feature {
  id: string;
  name: string; // Display name
  sketch: SketchState;
  
  // Feature Properties
  featureType: 'EXTRUDE' | 'REVOLVE'; 
  operation: 'NEW' | 'CUT'; // Additive or Subtractive
  transform: number[]; // 16-element Matrix4 array

  // Extrude Params
  extrusionDepth: number;
  throughAll: boolean;      

  // Revolve Params
  revolveAngle?: number; // In degrees (360 default)
  revolveAxisId?: string; // ID of the line used as axis
}
