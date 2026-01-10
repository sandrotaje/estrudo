
import { GoogleGenAI } from "@google/genai";
import { SketchState } from "../types";

// Correct initialization using process.env.API_KEY directly as a named parameter.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function getSketchAdvice(state: SketchState) {
  const prompt = `
    You are an expert CAD engineer. Analyze the current 2D sketch state and provide advice on constraints or missing geometric relations.
    Current Sketch Summary:
    - Points: ${state.points.length}
    - Lines: ${state.lines.length}
    - Constraints: ${state.constraints.length}
    
    State JSON snippet: ${JSON.stringify({
      pointCount: state.points.length,
      lineCount: state.lines.length,
      constraintTypes: state.constraints.map(c => c.type)
    })}

    Please provide a short, professional suggestion (max 3 sentences) on what the user should do next to fully define the sketch.
  `;

  try {
    // Use gemini-3-pro-preview for complex reasoning tasks like CAD analysis
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
    });
    return response.text;
  } catch (err) {
    console.error("Gemini Error:", err);
    return "Unable to get advice right now. Ensure your API key is valid.";
  }
}
