
import React from 'react';
import { SketchState } from '../types';

interface ToolbarProps {
  activeTool: SketchState['tool'];
  onSetTool: (tool: SketchState['tool']) => void;
  onToggleSidebar: () => void;
  viewMode: '2D' | '3D';
  onToggleViewMode: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({ 
  activeTool, onSetTool, onToggleSidebar, viewMode
}) => {
  const tools: { id: SketchState['tool'], icon: string, title: string }[] = [
    { id: 'SELECT', icon: '⬈', title: 'Select (S)' },
    { id: 'PAN', icon: '✋', title: 'Pan (P)' },
    { id: 'POINT', icon: '•', title: 'Point' },
    { id: 'LINE', icon: '╱', title: 'Line (L)' },
    { id: 'RECTANGLE', icon: '▭', title: 'Rectangle (R)' },
    { id: 'CIRCLE', icon: '○', title: 'Circle (C)' },
  ];

  return (
    <div className="relative h-16 bg-[#1a1a1a] border-b border-white/10 flex items-center px-4 gap-3 z-[60] shrink-0 shadow-lg">
      <button 
        onClick={onToggleSidebar} 
        className="w-11 h-11 flex items-center justify-center bg-[#2a2a2a] hover:bg-[#333] border border-white/5 rounded-xl text-xl text-blue-400 shrink-0 transition-colors active:scale-95 lg:hidden"
        title="Open Properties Sidebar"
      >
        ☰
      </button>
      
      <div className="h-8 w-px bg-white/10 shrink-0 lg:hidden" />
      
      {viewMode === '2D' ? (
        <div className="flex bg-[#0f0f0f] p-1 rounded-xl border border-white/5 gap-1 shrink-0">
          {tools.map(t => (
            <button
              key={t.id}
              onClick={() => onSetTool(t.id)}
              title={t.title}
              className={`w-11 h-11 rounded-lg flex items-center justify-center transition-all ${
                activeTool === t.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <span className="text-xl leading-none font-bold">{t.icon}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center px-4 text-gray-500 font-mono text-xs">
          3D PREVIEW MODE (READ ONLY)
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />
      
      {/* 
        Note: The 3D view toggle and undo/redo have been moved to a floating action bar in the canvas area 
        per user request, keeping the toolbar focused on tools.
      */}

    </div>
  );
};

export default Toolbar;
