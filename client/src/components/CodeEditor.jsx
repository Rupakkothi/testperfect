import React, { useEffect, useState } from 'react';

export default function CodeEditor({ code, onChange, language, onLanguageChange, languages = ['python', 'cpp', 'c', 'java'] }) {
  const [lineCount, setLineCount] = useState(1);

  useEffect(() => {
    const lines = code.split('\n').length;
    setLineCount(Math.max(lines, 1));
  }, [code]);

  const handleKeyDown = (e) => {
    // Intercept TAB key to insert spaces instead of shifting focus
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const val = e.target.value;
      const newCode = val.substring(0, start) + "    " + val.substring(end);
      onChange(newCode);
      
      // Reset cursor position
      setTimeout(() => {
        e.target.selectionStart = e.target.selectionEnd = start + 4;
      }, 0);
    }
  };

  return (
    <div className="sandbox-editor-wrapper">
      <div className="sandbox-header">
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Coding Terminal
        </span>
        <select 
          className="form-select" 
          value={language} 
          onChange={(e) => onLanguageChange(e.target.value)}
          style={{ width: 'auto', padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}
        >
          {languages.map(lang => (
            <option key={lang} value={lang}>
              {lang.toUpperCase()}
            </option>
          ))}
        </select>
      </div>
      
      <div className="sandbox-editor-area">
        <div className="line-numbers">
          {Array.from({ length: lineCount }).map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          className="code-textarea"
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck="false"
          placeholder="// Write your code here..."
        />
      </div>
    </div>
  );
}
