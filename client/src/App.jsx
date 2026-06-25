import React, { useState, useEffect, useRef } from 'react';
import { api, API_URL, setApiUrlOverride } from './utils/api';
import WebcamFeed from './components/WebcamFeed';
import CodeEditor from './components/CodeEditor';

export default function App() {
  // Navigation & Authentication
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [view, setView] = useState('login'); // 'login', 'candidate-dash', 'educator-dash', 'create-test', 'take-test', 'view-results', 'submit-success', 'verify-hardware'
  
  // Custom API configuration
  const [apiUrlOverrideInput, setApiUrlOverrideInput] = useState(API_URL);
  
  // Direct Test Access via Query Parameter (?testId=...)
  const [targetTestId, setTargetTestId] = useState(null);

  // Hardware Verification States
  const [camVerified, setCamVerified] = useState(false);
  const [micVerified, setMicVerified] = useState(false);

  // Test Creation States
  const [newTestTitle, setNewTestTitle] = useState('');
  const [newTestDesc, setNewTestDesc] = useState('');
  const [newTestDuration, setNewTestDuration] = useState(60);
  const [newTestQuestions, setNewTestQuestions] = useState([]);
  
  // Test Taking States
  const [availableTests, setAvailableTests] = useState([]);
  const [selectedTest, setSelectedTest] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [candidateAnswers, setCandidateAnswers] = useState({}); // { [questionId]: { selectedOption, code, language } }
  const [examTimer, setExamTimer] = useState(0); // in seconds
  const [violations, setViolations] = useState([]); // Array of {type, timestamp, details}
  const [warningMessage, setWarningMessage] = useState('');
  const [isExamCompleted, setIsExamCompleted] = useState(false);

  // Educator View States
  const [createdTests, setCreatedTests] = useState([]);
  const [activeResultsTest, setActiveResultsTest] = useState(null);
  const [testSubmissions, setTestSubmissions] = useState([]);
  const [editingTest, setEditingTest] = useState(null);
  const [editDurationInput, setEditDurationInput] = useState('');

  // Compiler state on Exam screen
  const [compileInputs, setCompileInputs] = useState({}); // { [questionId]: stdin }
  const [compileOutputs, setCompileOutputs] = useState({}); // { [questionId]: { stdout, stderr, status, time } }
  const [isRunningCode, setIsRunningCode] = useState(false);

  // Read query parameters on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tId = params.get('testId') || params.get('test');
    if (tId) {
      setTargetTestId(tId);
    }
  }, []);

  // Authentication validation
  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      api.get('/api/auth/me')
        .then(res => {
          setUser(res.user);
          // If candidate has a target test link, launch it immediately
          if (res.user.role === 'candidate' && targetTestId) {
            handleStartExam(targetTestId);
          } else {
            setView(res.user.role === 'educator' ? 'educator-dash' : 'candidate-dash');
          }
        })
        .catch(err => {
          console.error("Auth verify error", err);
          handleLogout();
        });
    }
  }, [token, targetTestId]);

  // Timer logic for Exam taking
  useEffect(() => {
    if (view !== 'take-test' || examTimer <= 0) return;
    
    const interval = setInterval(() => {
      setExamTimer(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          alert("Time is up! Your exam is being submitted automatically.");
          triggerAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [view, examTimer]);

  // Tab change / blur detection (Proctoring)
  useEffect(() => {
    if (view !== 'take-test') return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        logViolation('tab_switch', 'Candidate switched browser tab or minimized screen.');
        setWarningMessage('Warning: Browser focus lost! This violation has been logged.');
      }
    };

    const handleWindowBlur = () => {
      logViolation('window_blur', 'Candidate lost window focus.');
      setWarningMessage('Warning: Screen focus lost! Ensure you do not leave the test page.');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [view]);

  // Helper to append proctor violations
  const logViolation = (type, details) => {
    const newViolation = {
      type,
      timestamp: new Date().toISOString(),
      details
    };
    setViolations(prev => {
      const updated = [...prev, newViolation];
      const tabSwitches = updated.filter(v => v.type === 'tab_switch' || v.type === 'window_blur').length;
      if (tabSwitches >= 3) {
        alert("Maximum focus-loss violations exceeded. Your exam is submitting automatically.");
        triggerAutoSubmit(updated);
      }
      return updated;
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
    setView('login');
  };

  // Copy Direct Test URL helper
  const handleCopyTestLink = (testId) => {
    const link = `${window.location.origin}?testId=${testId}`;
    navigator.clipboard.writeText(link)
      .then(() => {
        alert(`Test link copied to clipboard:\n${link}`);
      })
      .catch(err => {
        console.error("Failed to copy link:", err);
        alert(`Copy URL manually: ${link}`);
      });
  };

  // Format seconds to MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // --- API HANDLERS ---

  // Auth Forms
  const handleAuth = async (username, password, role, isRegister) => {
    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const data = await api.post(endpoint, { username, password, role });
      
      // Save token immediately to localStorage so subsequent API calls retrieve it in headers
      localStorage.setItem('token', data.token);
      
      setToken(data.token);
      setUser(data.user);
      
      // Navigate immediately if direct exam link is target
      if (data.user.role === 'candidate' && targetTestId) {
        handleStartExam(targetTestId);
      } else {
        setView(data.user.role === 'educator' ? 'educator-dash' : 'candidate-dash');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  // Educator: Load created exams
  const loadEducatorDashboard = async () => {
    try {
      const tests = await api.get('/api/tests');
      setCreatedTests(tests);
    } catch (err) {
      alert("Failed to load dashboard tests: " + err.message);
    }
  };

  useEffect(() => {
    if (view === 'educator-dash') {
      loadEducatorDashboard();
    }
  }, [view]);

  // Educator: Save Test
  const handleSaveTest = async () => {
    if (!newTestTitle || newTestQuestions.length === 0) {
      alert("Please enter a test title and add at least one question.");
      return;
    }
    try {
      await api.post('/api/tests', {
        title: newTestTitle,
        description: newTestDesc,
        duration: newTestDuration,
        questions: newTestQuestions
      });
      alert("Test created successfully!");
      setNewTestTitle('');
      setNewTestDesc('');
      setNewTestDuration(60);
      setNewTestQuestions([]);
      setView('educator-dash');
    } catch (err) {
      alert("Failed to save test: " + err.message);
    }
  };

  // Educator: View test results
  const handleViewResults = async (test) => {
    try {
      const subs = await api.get(`/api/submissions/test/${test.id}`);
      setActiveResultsTest(test);
      setTestSubmissions(subs);
      setView('view-results');
    } catch (err) {
      alert("Error loading submissions: " + err.message);
    }
  };

  // Candidate: Load available exams
  const loadCandidateDashboard = async () => {
    try {
      const tests = await api.get('/api/tests');
      setAvailableTests(tests);
    } catch (err) {
      alert("Failed to load available exams: " + err.message);
    }
  };

  useEffect(() => {
    if (view === 'candidate-dash') {
      loadCandidateDashboard();
    }
  }, [view]);

  // Candidate: Start taking test (Triggers Device Check screen first)
  const handleStartExam = async (testId) => {
    try {
      const test = await api.get(`/api/tests/${testId}`);
      setSelectedTest(test);
      setCurrentQuestionIndex(0);
      
      const stubs = {};
      test.questions.forEach(q => {
        if (q.type === 'mcq') {
          stubs[q.id] = { selectedOption: null };
        } else {
          stubs[q.id] = {
            language: 'python',
            code: `import sys\n\ndef solve():\n    # Read input using sys.stdin.readline() or input()\n    # Print output using print()\n    # Example: line = sys.stdin.readline().strip()\n    pass\n\nif __name__ == '__main__':\n    solve()`
          };
        }
      });
      setCandidateAnswers(stubs);
      setViolations([]);
      setWarningMessage('');
      
      // Reset hardware verification status
      setCamVerified(false);
      setMicVerified(false);

      // Route to Device Verification Screen
      setView('verify-hardware');
    } catch (err) {
      alert("Error starting test (check if test exists): " + err.message);
      setView(user ? (user.role === 'educator' ? 'educator-dash' : 'candidate-dash') : 'login');
    }
  };

  // Candidate: Compile & Run code inside console
  const handleRunCode = async (questionId) => {
    const answer = candidateAnswers[questionId];
    if (!answer || !answer.code) {
      alert("Please write some code before executing.");
      return;
    }
    
    setIsRunningCode(true);
    try {
      const res = await api.post('/api/compiler/run', {
        code: answer.code,
        language: answer.language,
        stdin: compileInputs[questionId] || ""
      });
      
      setCompileOutputs(prev => ({
        ...prev,
        [questionId]: res
      }));
    } catch (err) {
      alert("Execution error: " + err.message);
    } finally {
      setIsRunningCode(false);
    }
  };

  // Candidate: Submit Exam
  const handleExamSubmit = async (customViolations) => {
    const confirmation = window.confirm("Are you sure you want to submit your exam?");
    if (!confirmation) return;

    await executeExamSubmission(customViolations);
  };

  const triggerAutoSubmit = async (customViolations) => {
    await executeExamSubmission(customViolations);
  };

  const executeExamSubmission = async (customViolations) => {
    try {
      const payload = {
        testId: selectedTest.id,
        answers: candidateAnswers,
        violations: customViolations || violations
      };

      const result = await api.post('/api/submissions', payload);
      
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(err => console.error(err));
      }

      setIsExamCompleted(result);
      setView('submit-success');
    } catch (err) {
      alert("Error submitting exam: " + err.message);
    }
  };

  // --- SUB-COMPONENTS / LAYOUTS ---

  // Auth Card Renderer
  function AuthPage() {
    const [isRegister, setIsRegister] = useState(false);
    const [usernameInput, setUsernameInput] = useState('');
    const [passwordInput, setPasswordInput] = useState('');
    const [roleInput, setRoleInput] = useState('candidate');

    const onSubmit = (e) => {
      e.preventDefault();
      handleAuth(usernameInput, passwordInput, roleInput, isRegister);
    };

    return (
      <div className="auth-wrapper">
        <div className="glass-card auth-card">
          <h2 style={{ textAlign: 'center', marginBottom: '0.25rem' }}>
            {isRegister ? 'Register Account' : 'Sign In'}
          </h2>
          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '2rem' }}>
            Welcome to <strong>testperfect</strong> platform
          </p>

          {targetTestId && (
            <div style={{ background: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.3)', color: '#c084fc', padding: '0.75rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.85rem', textAlign: 'center', fontWeight: 600 }}>
              🔗 You are logging in to take a direct exam link.
            </div>
          )}

          <form onSubmit={onSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                className="form-input"
                type="text"
                required
                value={usernameInput}
                onChange={e => setUsernameInput(e.target.value)}
                placeholder="Enter username"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                required
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                placeholder="Enter password"
              />
            </div>

            {isRegister && (
              <div className="form-group">
                <label className="form-label">Sign Up As</label>
                <select 
                  className="form-select"
                  value={roleInput}
                  onChange={e => setRoleInput(e.target.value)}
                >
                  <option value="candidate">Candidate (Student)</option>
                  <option value="educator">Educator (Teacher)</option>
                </select>
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
              {isRegister ? 'Sign Up' : 'Log In'}
            </button>
          </form>

          <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {isRegister ? 'Already have an account? ' : "Don't have an account? "}
            </span>
            <span 
              style={{ color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600 }}
              onClick={() => setIsRegister(!isRegister)}
            >
              {isRegister ? 'Log In' : 'Sign Up'}
            </span>
          </div>

          <div style={{ marginTop: '2rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
            <label className="form-label" style={{ fontSize: '0.75rem' }}>API Endpoint URL:</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                className="form-input" 
                type="text" 
                value={apiUrlOverrideInput}
                onChange={e => setApiUrlOverrideInput(e.target.value)}
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }} 
              />
              <button 
                className="btn btn-secondary" 
                onClick={() => setApiUrlOverride(apiUrlOverrideInput)}
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Educator: Create Test View
  function CreateTestPage() {
    const [qText, setQText] = useState('');
    const [qType, setQType] = useState('mcq');
    const [qMarks, setQMarks] = useState(5);
    
    const [mcqOpts, setMcqOpts] = useState(['', '', '', '']);
    const [mcqCorrect, setMcqCorrect] = useState(0);

    const [sampleTestCases, setSampleTestCases] = useState([{ input: '', expectedOutput: '', isSample: true }]);
    const [hiddenTestCases, setHiddenTestCases] = useState([{ input: '', expectedOutput: '', isSample: false }]);

    const addMcqOption = (index, value) => {
      const updated = [...mcqOpts];
      updated[index] = value;
      setMcqOpts(updated);
    };

    const addTestCase = (isSample) => {
      const tc = { input: '', expectedOutput: '', isSample };
      if (isSample) {
        setSampleTestCases([...sampleTestCases, tc]);
      } else {
        setHiddenTestCases([...hiddenTestCases, tc]);
      }
    };

    const updateTestCase = (isSample, index, field, value) => {
      const list = isSample ? [...sampleTestCases] : [...hiddenTestCases];
      list[index][field] = value;
      if (isSample) setSampleTestCases(list);
      else setHiddenTestCases(list);
    };

    const handleAddQuestion = () => {
      if (!qText.trim()) return alert("Question text is required.");

      const newQ = {
        type: qType,
        questionText: qText,
        marks: qMarks
      };

      if (qType === 'mcq') {
        if (mcqOpts.some(opt => !opt.trim())) {
          return alert("Please fill all MCQ options.");
        }
        newQ.options = mcqOpts;
        newQ.correctOption = mcqCorrect;
      } else {
        const allTestCases = [
          ...sampleTestCases.filter(tc => tc.input.trim() || tc.expectedOutput.trim()),
          ...hiddenTestCases.filter(tc => tc.input.trim() || tc.expectedOutput.trim())
        ];
        if (allTestCases.length === 0) {
          return alert("Coding question requires at least one test case.");
        }
        newQ.testCases = allTestCases;
        newQ.languages = ['python', 'cpp', 'c', 'java'];
        newQ.starterCode = {
          python: `import sys\n\ndef solve():\n    # Read input using sys.stdin.readline() or input()\n    # Print output using print()\n    pass\n\nif __name__ == '__main__':\n    solve()`,
          cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    // Read input using cin\n    // Write output using cout\n    return 0;\n}`,
          c: `#include <stdio.h>\n\nint main() {\n    // Read using scanf\n    // Write using printf\n    return 0;\n}`,
          java: `import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Read input using scanner\n        // Write output using System.out.println()\n    }\n}`
        };
      }

      setNewTestQuestions([...newTestQuestions, newQ]);
      
      setQText('');
      setQMarks(5);
      setMcqOpts(['', '', '', '']);
      setMcqCorrect(0);
      setSampleTestCases([{ input: '', expectedOutput: '', isSample: true }]);
      setHiddenTestCases([{ input: '', expectedOutput: '', isSample: false }]);
    };

    return (
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h2>Create Online Test</h2>
          <button className="btn btn-secondary" onClick={() => setView('educator-dash')}>Back</button>
        </div>

        <div className="grid-cols-2">
          <div>
            <h3>1. Test Details</h3>
            <div className="form-group">
              <label className="form-label">Test Title</label>
              <input 
                className="form-input" 
                type="text" 
                placeholder="e.g. Algorithms Mid-Term" 
                value={newTestTitle}
                onChange={e => setNewTestTitle(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description (Optional)</label>
              <textarea 
                className="form-textarea" 
                placeholder="Instructions or syllabus summary..."
                value={newTestDesc}
                onChange={e => setNewTestDesc(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Duration (Minutes)</label>
              <input 
                className="form-input" 
                type="number" 
                value={newTestDuration}
                onChange={e => setNewTestDuration(e.target.value)}
              />
            </div>

            <div style={{ marginTop: '2rem' }}>
              <h3>Questions Added ({newTestQuestions.length})</h3>
              {newTestQuestions.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No questions added yet. Use the question form on the right.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {newTestQuestions.map((q, idx) => (
                    <div key={idx} style={{ background: 'rgba(255,255,255,0.01)', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                        <span>QUESTION {idx + 1} ({q.type.toUpperCase()})</span>
                        <span>{q.marks} Marks</span>
                      </div>
                      <div style={{ fontWeight: 500, marginTop: '0.25rem' }}>{q.questionText}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '2rem' }}>
            <h3>2. Add Question</h3>
            <div className="form-group">
              <label className="form-label">Question Type</label>
              <select className="form-select" value={qType} onChange={e => setQType(e.target.value)}>
                <option value="mcq">Multiple Choice Question (MCQ)</option>
                <option value="coding">Coding Question (Python, C, C++, Java)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Question Text / Statement</label>
              <textarea 
                className="form-textarea" 
                placeholder="Type question content here..."
                value={qText}
                onChange={e => setQText(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Marks Weightage</label>
              <input 
                className="form-input" 
                type="number" 
                value={qMarks}
                onChange={e => setQMarks(parseInt(e.target.value))}
              />
            </div>

            {qType === 'mcq' ? (
              <div>
                <h4>MCQ Options</h4>
                {mcqOpts.map((opt, i) => (
                  <div key={i} className="form-group" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input 
                      type="radio" 
                      name="correct-mcq" 
                      checked={mcqCorrect === i}
                      onChange={() => setMcqCorrect(i)} 
                      style={{ cursor: 'pointer' }}
                    />
                    <input 
                      className="form-input" 
                      type="text" 
                      placeholder={`Option ${i+1}`}
                      value={opt}
                      onChange={e => addMcqOption(i, e.target.value)}
                    />
                  </div>
                ))}
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>* Select radio button next to the correct option.</span>
              </div>
            ) : (
              <div>
                <h4 style={{ marginTop: '1rem' }}>Test Cases</h4>
                
                <h5>Sample Test Cases (Visible to candidates)</h5>
                {sampleTestCases.map((tc, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <input 
                      className="form-input" 
                      placeholder="Input" 
                      value={tc.input} 
                      onChange={e => updateTestCase(true, idx, 'input', e.target.value)}
                    />
                    <input 
                      className="form-input" 
                      placeholder="Expected Output" 
                      value={tc.expectedOutput} 
                      onChange={e => updateTestCase(true, idx, 'expectedOutput', e.target.value)}
                    />
                  </div>
                ))}
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginBottom: '1rem' }} onClick={() => addTestCase(true)}>
                  + Add Sample Test Case
                </button>

                <h5>Hidden Test Cases (Checked during final submission)</h5>
                {hiddenTestCases.map((tc, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <input 
                      className="form-input" 
                      placeholder="Input" 
                      value={tc.input} 
                      onChange={e => updateTestCase(false, idx, 'input', e.target.value)}
                    />
                    <input 
                      className="form-input" 
                      placeholder="Expected Output" 
                      value={tc.expectedOutput} 
                      onChange={e => updateTestCase(false, idx, 'expectedOutput', e.target.value)}
                    />
                  </div>
                ))}
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginBottom: '1rem' }} onClick={() => addTestCase(false)}>
                  + Add Hidden Test Case
                </button>
              </div>
            )}

            <button 
              className="btn btn-success" 
              onClick={handleAddQuestion} 
              style={{ width: '100%', marginTop: '1.5rem' }}
            >
              Add Question to Test
            </button>
          </div>
        </div>

        <div style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary btn-lg" onClick={handleSaveTest}>
            Save and Release Test
          </button>
        </div>
      </div>
    );
  }

  // Educator: Dashboard View
  function EducatorDashboard() {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
          <div>
            <h1 className="gradient-text">Educator Console</h1>
            <p>Create examinations, copy test links to send to students, and inspect proctor monitor logs.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setView('create-test')}>
            + Create New Test
          </button>
        </div>

        <div className="glass-card">
          <h2 style={{ marginBottom: '1.5rem' }}>Your Released Tests</h2>
          {createdTests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
              No tests created yet. Click "+ Create New Test" to get started.
            </div>
          ) : (
            <div className="table-container">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Test Title</th>
                    <th>Questions</th>
                    <th>Duration</th>
                    <th>Date Released</th>
                    <th style={{ textAlignment: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {createdTests.map(test => (
                    <tr key={test.id}>
                      <td style={{ fontWeight: 600 }}>{test.title}</td>
                      <td>{test.questions.length}</td>
                      <td>{test.duration} min</td>
                      <td style={{ color: 'var(--text-muted)' }}>{new Date(test.createdAt).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleCopyTestLink(test.id)}>
                          🔗 Copy Link
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditingTest(test); setEditDurationInput(test.duration); }}>
                          🕒 Edit Time
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => handleViewResults(test)}>
                          View Results
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Edit Test Settings Modal */}
        {editingTest && (
          <div className="modal-overlay">
            <div className="glass-card modal-content" style={{ border: '1px solid var(--accent-primary)', textAlign: 'left', maxWidth: '400px' }}>
              <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🕒 Edit Test Settings
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                Modify parameters for: <strong>{editingTest.title}</strong>
              </p>
              
              <div className="form-group">
                <label className="form-label">Duration (Minutes)</label>
                <input 
                  className="form-input" 
                  type="number" 
                  required
                  min="1"
                  value={editDurationInput}
                  onChange={e => setEditDurationInput(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ flex: 1 }}
                  onClick={() => setEditingTest(null)}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary" 
                  style={{ flex: 1 }}
                  onClick={async () => {
                    if (!editDurationInput || parseInt(editDurationInput) <= 0) {
                      return alert("Please enter a valid duration.");
                    }
                    try {
                      await api.put(`/api/tests/${editingTest.id}`, {
                        duration: parseInt(editDurationInput)
                      });
                      alert("Test duration updated successfully!");
                      setEditingTest(null);
                      loadEducatorDashboard(); // Refresh table
                    } catch (err) {
                      alert("Error updating test: " + err.message);
                    }
                  }}
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Educator: Submissions Results View
  function ResultsPage() {
    const [selectedSubmission, setSelectedSubmission] = useState(null);

    return (
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h2>Results: {activeResultsTest?.title}</h2>
            <p>Analyze grades, view submitted code files, and inspect proctor warning history.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => setView('educator-dash')}>Back</button>
        </div>

        <div className="grid-cols-2">
          {/* Left panel: List of candidates */}
          <div>
            <h3>Candidate Submissions ({testSubmissions.length})</h3>
            {testSubmissions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No candidates have submitted this exam yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {testSubmissions.map(sub => {
                  const focusLosses = sub.violations.filter(v => v.type === 'tab_switch' || v.type === 'window_blur').length;
                  const noiseAlerts = sub.violations.filter(v => v.type === 'audio_alert').length;
                  return (
                    <div 
                      key={sub.id} 
                      className={`glass-card ${selectedSubmission?.id === sub.id ? 'active' : ''}`}
                      style={{ 
                        padding: '1.25rem', 
                        cursor: 'pointer',
                        borderColor: selectedSubmission?.id === sub.id ? 'var(--accent-primary)' : 'var(--border-color)',
                        background: selectedSubmission?.id === sub.id ? 'rgba(139, 92, 246, 0.05)' : 'rgba(255,255,255,0.01)'
                      }}
                      onClick={() => setSelectedSubmission(sub)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>{sub.candidateName}</span>
                        <span className="badge badge-primary">{sub.score} / {sub.totalMarks} Marks</span>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                        <span style={{ color: focusLosses > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                          Focus Violations: {focusLosses}
                        </span>
                        <span style={{ color: noiseAlerts > 0 ? 'var(--warning)' : 'var(--text-muted)', fontWeight: 600 }}>
                          Noise Alerts: {noiseAlerts}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right panel: Candidate details log inspection */}
          <div>
            {selectedSubmission ? (
              <div>
                <h3 style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Submission Details</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Submitted {new Date(selectedSubmission.submitTime).toLocaleTimeString()}
                  </span>
                </h3>
                
                <h4 style={{ marginTop: '1.5rem' }}>Proctor Violations Log</h4>
                {selectedSubmission.violations.length === 0 ? (
                  <p style={{ color: 'var(--success)', fontSize: '0.9rem' }}>✓ Clean session. No browser tab switching or suspicious noises recorded.</p>
                ) : (
                  <div className="violation-log-list">
                    {selectedSubmission.violations.map((v, idx) => (
                      <div key={idx} className="violation-log-item" style={{ 
                        borderColor: v.type === 'audio_alert' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        background: v.type === 'audio_alert' ? 'rgba(245, 158, 11, 0.02)' : 'rgba(239, 68, 68, 0.02)'
                      }}>
                        <div className="violation-title" style={{ color: v.type === 'audio_alert' ? '#fde047' : '#fca5a5' }}>
                          ⚠️ {v.type.toUpperCase().replace('_', ' ')}
                        </div>
                        <div style={{ fontSize: '0.85rem', flex: 1, padding: '0 1rem' }}>{v.details}</div>
                        <div className="violation-time">{new Date(v.timestamp).toLocaleTimeString()}</div>
                      </div>
                    ))}
                  </div>
                )}

                <h4 style={{ marginTop: '2rem' }}>Answer Submissions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                  {activeResultsTest?.questions.map((q, idx) => {
                    const ans = selectedSubmission.answers[q.id];
                    return (
                      <div key={q.id} style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          <span>QUESTION {idx + 1} ({q.type.toUpperCase()})</span>
                          <span>Score: {ans ? ans.marksAwarded : 0} / {q.marks} Marks</span>
                        </div>
                        <div style={{ fontWeight: 500, margin: '0.5rem 0' }}>{q.questionText}</div>
                        
                        {q.type === 'mcq' ? (
                          <div style={{ fontSize: '0.9rem' }}>
                            <div style={{ color: ans?.selectedOption === q.correctOption ? 'var(--success)' : 'var(--danger)' }}>
                              Candidate Answer: {q.options[ans?.selectedOption] || 'None'}
                            </div>
                            <div style={{ color: 'var(--text-muted)' }}>
                              Correct Answer: {q.options[q.correctOption]}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--accent-secondary)' }}>
                              Language: {ans?.language?.toUpperCase()} | Test Cases Passed: {ans?.testCasesPassed} / {ans?.totalTestCases}
                            </div>
                            <pre style={{ 
                              background: '#0a0910', 
                              padding: '0.75rem', 
                              borderRadius: '6px', 
                              fontSize: '0.85rem', 
                              overflowX: 'auto',
                              fontFamily: 'var(--font-mono)',
                              border: '1px solid rgba(255,255,255,0.03)',
                              marginTop: '0.5rem'
                            }}>
                              <code>{ans?.code || '# Code not found'}</code>
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '5rem 0' }}>
                Select a candidate from the left panel to review logs, grades, and code submissions.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Candidate: Dashboard View
  function CandidateDashboard() {
    return (
      <div>
        <div style={{ marginBottom: '2.5rem' }}>
          <h1 className="gradient-text">Candidate Dashboard</h1>
          <p>Verify your webcam access, review instructions, and start your exams below.</p>
        </div>

        <div className="glass-card">
          <h2 style={{ marginBottom: '1.5rem' }}>Your Scheduled Exams</h2>
          {availableTests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
              No exams scheduled or available currently.
            </div>
          ) : (
            <div className="table-container">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Exam Title</th>
                    <th>Questions</th>
                    <th>Total Marks</th>
                    <th>Time Limit</th>
                    <th style={{ textAlignment: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {availableTests.map(test => (
                    <tr key={test.id}>
                      <td style={{ fontWeight: 600 }}>{test.title}</td>
                      <td>{test.questionCount} Questions</td>
                      <td>{test.totalMarks} Marks</td>
                      <td>{test.duration} min</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => handleStartExam(test.id)}>
                          Start Exam
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Intermediate Hardware Setup Verification Screen
  function HardwareSetupPage() {
    const handleProceedToExam = () => {
      // Enter Fullscreen
      try {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(err => console.warn(err));
        }
      } catch (e) {
        console.warn("Fullscreen request bypassed:", e);
      }
      
      // Start countdown timer
      setExamTimer(selectedTest.duration * 60);
      setViolations([]);
      // Start testconsole
      setView('take-test');
    };

    return (
      <div className="glass-card" style={{ maxWidth: '900px', margin: '0 auto' }}>
        <h2 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }} className="gradient-text">
          🛡️ Proctor Setup & Device Check
        </h2>
        
        <div className="grid-cols-2">
          {/* Instructions Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', justify: 'center' }}>
            <h3 style={{ marginBottom: '1.25rem' }}>Verify Your Hardware</h3>
            <p>This exam is actively proctored. Before launching the examination console, you must grant permissions and verify your devices.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', margin: '1rem 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '50%', 
                  background: camVerified ? 'var(--success)' : 'rgba(239, 68, 68, 0.1)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  fontWeight: 800,
                  color: '#fff',
                  boxShadow: camVerified ? '0 0 10px var(--success)' : 'none'
                }}>
                  {camVerified ? '✓' : '1'}
                </div>
                <div>
                  <span style={{ fontWeight: 600, display: 'block' }}>Webcam Check</span>
                  <span style={{ fontSize: '0.85rem', color: camVerified ? 'var(--success)' : 'var(--text-muted)' }}>
                    {camVerified ? 'Webcam verified successfully.' : 'Please allow camera permissions.'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '50%', 
                  background: micVerified ? 'var(--success)' : 'rgba(239, 68, 68, 0.1)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  fontWeight: 800,
                  color: '#fff',
                  boxShadow: micVerified ? '0 0 10px var(--success)' : 'none'
                }}>
                  {micVerified ? '✓' : '2'}
                </div>
                <div>
                  <span style={{ fontWeight: 600, display: 'block' }}>Microphone Check</span>
                  <span style={{ fontSize: '0.85rem', color: micVerified ? 'var(--success)' : 'var(--text-muted)' }}>
                    {micVerified ? 'Microphone verified successfully.' : 'Please allow mic permissions and speak.'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              ⚠️ <strong>Proctor Rules</strong>: Exiting fullscreen, switching browser tabs, minimizing the screen, or loud background voices will trigger security flags and may result in your exam being auto-submitted.
            </div>

            <button 
              className={`btn ${camVerified && micVerified ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '100%', padding: '1rem', fontSize: '1.05rem' }}
              disabled={!(camVerified && micVerified)}
              onClick={handleProceedToExam}
            >
              {camVerified && micVerified ? 'Verify & Start Exam' : 'Awaiting Hardware Permission...'}
            </button>
          </div>

          {/* Media Stream Verification Preview */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <WebcamFeed 
              onAudioAlert={() => {}} // No alerts on check screen
              onStatusChange={(status) => {
                setCamVerified(status.camera);
                setMicVerified(status.mic);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Exam environment (Candidate view)
  function ExamConsole() {
    const q = selectedTest.questions[currentQuestionIndex];
    const answer = candidateAnswers[q.id] || {};

    const handleMcqSelect = (optionIndex) => {
      setCandidateAnswers(prev => ({
        ...prev,
        [q.id]: { ...prev[q.id], selectedOption: optionIndex }
      }));
    };

    const handleCodeChange = (newCode) => {
      setCandidateAnswers(prev => ({
        ...prev,
        [q.id]: { ...prev[q.id], code: newCode }
      }));
    };

    const handleLanguageChange = (newLang) => {
      const stubs = {
        python: `import sys\n\ndef solve():\n    # Read input using sys.stdin.readline() or input()\n    # Print output using print()\n    pass\n\nif __name__ == '__main__':\n    solve()`,
        cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    // Read input using cin\n    // Write output using cout\n    return 0;\n}`,
        c: `#include <stdio.h>\n\nint main() {\n    // Read using scanf\n    // Write using printf\n    return 0;\n}`,
        java: `import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Read input using scanner\n        // Write output using System.out.println()\n    }\n}`
      };

      setCandidateAnswers(prev => ({
        ...prev,
        [q.id]: { 
          ...prev[q.id], 
          language: newLang,
          code: stubs[newLang] || prev[q.id].code
        }
      }));
    };

    return (
      <div className="exam-layout">
        {/* Left Side: Questions navigator */}
        <div className="exam-sidebar-left glass-card" style={{ padding: '1.5rem' }}>
          <div className="question-navigator">
            <h3>Exam Grid</h3>
            <div className="question-grid">
              {selectedTest.questions.map((question, idx) => {
                const ans = candidateAnswers[question.id];
                const isAnswered = ans && (ans.selectedOption !== null && ans.selectedOption !== undefined || (question.type === 'coding' && ans.code && ans.code.length > 50));
                return (
                  <button 
                    key={question.id}
                    className={`q-nav-btn ${idx === currentQuestionIndex ? 'active' : ''} ${isAnswered ? 'answered' : ''}`}
                    onClick={() => setCurrentQuestionIndex(idx)}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
            
            <div style={{ marginTop: '2rem', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div>🟢 Green: Attempted</div>
              <div>🔵 Violet: Current</div>
              <div>⚫ Grey: Unattempted</div>
            </div>
          </div>
        </div>

        {/* Center: Main exam console question panel */}
        <div className="exam-center-panel glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
            <h2>Question {currentQuestionIndex + 1} of {selectedTest.questions.length}</h2>
            <span className="badge badge-primary">{q.marks} Marks</span>
          </div>

          <div style={{ fontSize: '1.15rem', whiteSpace: 'pre-wrap', fontWeight: 500, color: '#fff' }}>
            {q.questionText}
          </div>

          {q.type === 'mcq' ? (
            <div className="mcq-container">
              {q.options.map((opt, idx) => (
                <div 
                  key={idx} 
                  className={`mcq-option-card ${answer.selectedOption === idx ? 'selected' : ''}`}
                  onClick={() => handleMcqSelect(idx)}
                >
                  <div className="mcq-radio" />
                  <span className="mcq-text">{opt}</span>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <CodeEditor
                code={answer.code || ''}
                language={answer.language || 'python'}
                onChange={handleCodeChange}
                onLanguageChange={handleLanguageChange}
                languages={q.languages}
              />
              
              <div style={{ marginTop: '1.75rem' }}>
                <h4>Test Output Terminal</h4>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <span className="form-label">Stdin Inputs</span>
                    <textarea 
                      className="form-textarea" 
                      style={{ minHeight: '60px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                      placeholder="Enter inputs here..."
                      value={compileInputs[q.id] || ''}
                      onChange={e => setCompileInputs({ ...compileInputs, [q.id]: e.target.value })}
                    />
                  </div>
                  <div style={{ alignSelf: 'flex-end' }}>
                    <button 
                      className="btn btn-success" 
                      onClick={() => handleRunCode(q.id)}
                      disabled={isRunningCode}
                    >
                      {isRunningCode ? 'Compiling...' : 'Run Code'}
                    </button>
                  </div>
                </div>

                {compileOutputs[q.id] && (
                  <div className="compiler-output-panel">
                    <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Execution Result:</div>
                    {compileOutputs[q.id].compile_output ? (
                      <div className="output-compile-err">{compileOutputs[q.id].compile_output}</div>
                    ) : compileOutputs[q.id].stderr ? (
                      <div className="output-stderr">{compileOutputs[q.id].stderr}</div>
                    ) : (
                      <div className="output-stdout">{compileOutputs[q.id].stdout || '[Empty Output]'}</div>
                    )}
                    <div className="output-status">
                      <span>Status: {compileOutputs[q.id].status?.description}</span>
                      <span>Time: {compileOutputs[q.id].time}s | Memory: {compileOutputs[q.id].memory}KB</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem', marginTop: 'auto' }}>
            <button 
              className="btn btn-secondary"
              disabled={currentQuestionIndex === 0}
              onClick={() => setCurrentQuestionIndex(prev => prev - 1)}
            >
              Previous
            </button>
            <button 
              className="btn btn-secondary"
              disabled={currentQuestionIndex === selectedTest.questions.length - 1}
              onClick={() => setCurrentQuestionIndex(prev => prev + 1)}
            >
              Next Question
            </button>
          </div>
        </div>

        {/* Right Side: Webcam feed, timer, Submit button */}
        <div className="exam-sidebar-right proctor-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card" style={{ padding: '1.25rem', textAlign: 'center', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05rem' }}>TIME REMAINING</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: examTimer < 300 ? 'var(--danger)' : 'var(--accent-primary)' }}>
              {formatTime(examTimer)}
            </div>
          </div>

          <WebcamFeed 
            onAudioAlert={(msg) => logViolation('audio_alert', msg)}
            onStatusChange={(status) => {
              if (!status.camera) logViolation('camera_inactive', 'Candidate camera stream blocked / errored.');
              if (!status.mic) logViolation('mic_inactive', 'Candidate mic input blocked / errored.');
            }}
          />

          <button 
            className="btn btn-primary" 
            style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}
            onClick={() => handleExamSubmit()}
          >
            Submit Exam
          </button>
        </div>

        {/* Overlay popup warnings */}
        {warningMessage && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-icon">⚠️</div>
              <h2 style={{ color: 'var(--danger)', margin: '1rem 0' }}>Security Alert</h2>
              <p style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>{warningMessage}</p>
              <button 
                className="btn btn-danger" 
                onClick={() => setWarningMessage('')}
                style={{ marginTop: '1.5rem', width: '100%' }}
              >
                I Understand and Agree to Continue
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Submission Completed view
  function SubmissionSuccessPage() {
    return (
      <div className="auth-wrapper">
        <div className="glass-card" style={{ textAlign: 'center', maxWidth: '480px', padding: '3.5rem 2rem' }}>
          <span style={{ fontSize: '4.5rem' }}>🎉</span>
          <h2 style={{ margin: '1rem 0' }}>Exam Completed</h2>
          <p>Your answers have been graded and recorded successfully.</p>
          <div style={{ background: 'rgba(139, 92, 246, 0.08)', padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(139, 92, 246, 0.2)', margin: '2rem 0' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'block', marginBottom: '0.25rem', fontWeight: 600, letterSpacing: '0.05em' }}>GRADE SCORE</span>
            <span style={{ fontSize: '2.75rem', fontWeight: 800, color: '#fff' }}>
              {isExamCompleted?.score} / {isExamCompleted?.totalMarks} Marks
            </span>
          </div>
          <button className="btn btn-primary" onClick={() => {
            window.history.pushState({}, document.title, window.location.pathname);
            setTargetTestId(null);
            setView('candidate-dash');
          }}>
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Navigation controller
  const renderView = () => {
    switch (view) {
      case 'login':
        return AuthPage();
      case 'candidate-dash':
        return CandidateDashboard();
      case 'educator-dash':
        return EducatorDashboard();
      case 'create-test':
        return CreateTestPage();
      case 'view-results':
        return ResultsPage();
      case 'verify-hardware':
        return HardwareSetupPage();
      case 'take-test':
        return ExamConsole();
      case 'submit-success':
        return SubmissionSuccessPage();
      default:
        return AuthPage();
    }
  };

  return (
    <div className="app-container">
      {/* Background Orbs */}
      <div className="bg-orb orb-violet"></div>
      <div className="bg-orb orb-pink"></div>
      <div className="bg-orb orb-blue"></div>

      <nav className="navbar">
        <div className="nav-logo" onClick={() => {
          if (view !== 'take-test' && view !== 'verify-hardware' && user) {
            setView(user.role === 'educator' ? 'educator-dash' : 'candidate-dash');
          }
        }} style={{ cursor: 'pointer' }}>
          🛡️ testperfect
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="developer-badge">
            👨‍💻 Dev: Rupak Reddy
          </div>
          {user && (
            <div className="nav-links">
              <span className="user-badge">{user.username} ({user.role})</span>
              <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Logout</button>
            </div>
          )}
        </div>
      </nav>
      
      <main className="main-content">
        {renderView()}
      </main>

      <footer>
        <div>
          &copy; 2026 <strong>testperfect</strong>. All rights reserved. Developed with ❤️ by <strong>Rupak Reddy</strong>.
        </div>
      </footer>
    </div>
  );
}
