const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const http = require('https');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'exam_secret_key_12345';

app.use(cors());
app.use(express.json());

// Helper function to query public Judge0 API
function executeCodeWithJudge0(languageId, sourceCode, stdin) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      source_code: sourceCode,
      language_id: languageId,
      stdin: stdin || "",
      // We will avoid sending expected_output to avoid Judge0 internal scoring.
      // We'll score it ourselves to be 100% accurate and flexible.
    });

    const options = {
      hostname: 'ce.judge0.com',
      port: 443,
      path: '/submissions?base64_encoded=false&wait=true',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Failed to parse Judge0 response"));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

// Map frontend languages to Judge0 ids
const LANGUAGE_MAPPING = {
  'c': 50,      // C (GCC 9.2.0)
  'cpp': 54,    // C++ (GCC 9.2.0)
  'java': 62,   // Java (OpenJDK 13.0.1)
  'python': 71  // Python (3.8.1)
};

// Middleware: Authenticate User
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: "Access denied. No token provided." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token." });
    req.user = user;
    next();
  });
}

// Middleware: Require Educator
function requireEducator(req, res, next) {
  if (req.user.role !== 'educator') {
    return res.status(403).json({ error: "Access denied. Educator role required." });
  }
  next();
}

// --- AUTH ROUTES ---

// Register
app.post('/api/auth/register', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: "Please fill all fields" });
  }

  const users = db.getUsers();
  if (users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Username already exists" });
  }

  const passwordHash = bcrypt.hashSync(password, 8);
  const newUser = {
    id: 'u_' + Math.random().toString(36).substr(2, 9),
    username,
    passwordHash,
    role: role === 'educator' ? 'educator' : 'candidate'
  };

  db.saveUser(newUser);

  const token = jwt.sign({ id: newUser.id, username: newUser.username, role: newUser.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: newUser.id, username: newUser.username, role: newUser.role } });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Please enter username and password" });
  }

  const users = db.getUsers();
  const user = users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase());
  
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: "Invalid username or password" });
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// Get Current User
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});


// --- TEST ROUTES ---

// Create Test (Educator Only)
app.post('/api/tests', authenticateToken, requireEducator, (req, res) => {
  const { title, description, duration, questions, scheduledAt } = req.body;
  if (!title || !duration || !questions || !Array.isArray(questions)) {
    return res.status(400).json({ error: "Missing required test fields." });
  }

  const newTest = {
    id: 't_' + Math.random().toString(36).substr(2, 9),
    title,
    description: description || "",
    duration: parseInt(duration),
    scheduledAt: scheduledAt || null, // ISO date-time string, null means always available
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    questions: questions.map(q => ({
      id: 'q_' + Math.random().toString(36).substr(2, 9),
      type: q.type, // 'mcq' or 'coding'
      questionText: q.questionText,
      options: q.options || [], // MCQ only
      correctOption: q.correctOption !== undefined ? parseInt(q.correctOption) : null, // MCQ only
      languages: q.languages || ['python', 'cpp', 'c', 'java'], // Coding only
      starterCode: q.starterCode || {}, // Coding only
      testCases: q.testCases || [], // Coding only: { input, expectedOutput, isSample: boolean }
      marks: parseInt(q.marks) || 5
    }))
  };

  db.saveTest(newTest);
  res.json(newTest);
});

// Update Test Settings (Educator Only)
app.put('/api/tests/:id', authenticateToken, requireEducator, (req, res) => {
  const { title, description, duration, scheduledAt } = req.body;
  const dbData = db.readDb();
  const testIdx = dbData.tests.findIndex(t => t.id === req.params.id);

  if (testIdx === -1) {
    return res.status(404).json({ error: "Test not found." });
  }

  const test = dbData.tests[testIdx];
  if (test.createdBy !== req.user.id) {
    return res.status(403).json({ error: "Access denied. You can only edit tests you created." });
  }

  if (title !== undefined) test.title = title;
  if (description !== undefined) test.description = description;
  if (duration !== undefined) test.duration = parseInt(duration);
  if (scheduledAt !== undefined) test.scheduledAt = scheduledAt || null;

  dbData.tests[testIdx] = test;
  db.writeDb(dbData);

  res.json(test);
});

// List Tests
app.get('/api/tests', authenticateToken, (req, res) => {
  const tests = db.getTests();
  // If educator, return all tests they created. If candidate, return all available tests.
  if (req.user.role === 'educator') {
    return res.json(tests.filter(t => t.createdBy === req.user.id));
  } else {
    // Candidates should not see the correct options or hidden test cases in the test list
    const candidateTests = tests.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      duration: t.duration,
      scheduledAt: t.scheduledAt || null,
      questionCount: t.questions.length,
      totalMarks: t.questions.reduce((sum, q) => sum + q.marks, 0)
    }));
    return res.json(candidateTests);
  }
});

// Get Specific Test
app.get('/api/tests/:id', authenticateToken, (req, res) => {
  const tests = db.getTests();
  const test = tests.find(t => t.id === req.params.id);
  if (!test) return res.status(404).json({ error: "Test not found" });

  if (req.user.role === 'educator') {
    return res.json(test);
  }

  // Time-gate: Candidates can only access the test at or after the scheduled time
  if (test.scheduledAt) {
    const now = new Date();
    const scheduled = new Date(test.scheduledAt);
    if (now < scheduled) {
      const diffMs = scheduled - now;
      const diffMins = Math.ceil(diffMs / 60000);
      return res.status(403).json({
        error: `This exam is not yet available. It is scheduled for ${scheduled.toLocaleString()}. Please try again in ${diffMins} minute(s).`,
        scheduledAt: test.scheduledAt
      });
    }
  }

  // Sanitized test details for Candidate: hide correct answers and hidden test cases!
  const sanitizedQuestions = test.questions.map(q => {
    const sanitized = {
      id: q.id,
      type: q.type,
      questionText: q.questionText,
      marks: q.marks
    };

    if (q.type === 'mcq') {
      sanitized.options = q.options;
      // Do not return correctOption
    } else if (q.type === 'coding') {
      sanitized.languages = q.languages;
      sanitized.starterCode = q.starterCode;
      // Return ONLY sample test cases (isSample === true)
      sanitized.testCases = (q.testCases || []).filter(tc => tc.isSample === true);
    }
    return sanitized;
  });

  res.json({
    id: test.id,
    title: test.title,
    description: test.description,
    duration: test.duration,
    scheduledAt: test.scheduledAt || null,
    questions: sanitizedQuestions
  });
});


// --- COMPILER / SANDBOX PROXY ROUTE ---

// Run Code (Public / Authenticated Candidates/Educators)
app.post('/api/compiler/run', authenticateToken, async (req, res) => {
  const { code, language, stdin } = req.body;
  if (!code || !language) {
    return res.status(400).json({ error: "Code and language selection are required." });
  }

  const languageId = LANGUAGE_MAPPING[language.toLowerCase()];
  if (!languageId) {
    return res.status(400).json({ error: "Unsupported language selection." });
  }

  try {
    const result = await executeCodeWithJudge0(languageId, code, stdin);
    res.json({
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      compile_output: result.compile_output || "",
      status: result.status || { description: "Unknown" },
      time: result.time || "0",
      memory: result.memory || "0"
    });
  } catch (error) {
    console.error("Code compilation error:", error);
    res.status(500).json({ error: "Code execution failed. Please try again." });
  }
});


// --- SUBMISSIONS & PROCTORING ROUTES ---

// Submit Exam
app.post('/api/submissions', authenticateToken, async (req, res) => {
  const { testId, answers, violations } = req.body;
  
  if (!testId || !answers) {
    return res.status(400).json({ error: "Missing submission details." });
  }

  const tests = db.getTests();
  const test = tests.find(t => t.id === testId);
  if (!test) return res.status(404).json({ error: "Test not found." });

  // Prevent duplicate submissions
  const submissions = db.getSubmissions();
  const existingSubmission = submissions.find(s => s.candidateId === req.user.id && s.testId === testId);
  if (existingSubmission) {
    return res.status(400).json({ error: "You have already submitted this exam." });
  }

  let totalScore = 0;
  let testTotalMarks = 0;
  const gradedAnswers = {};

  // Grade the exam questions
  for (const question of test.questions) {
    testTotalMarks += question.marks;
    const candidateAnswer = answers[question.id];

    if (!candidateAnswer) {
      gradedAnswers[question.id] = {
        type: question.type,
        marksAwarded: 0,
        unanswered: true
      };
      continue;
    }

    if (question.type === 'mcq') {
      const isCorrect = parseInt(candidateAnswer.selectedOption) === parseInt(question.correctOption);
      const marksAwarded = isCorrect ? question.marks : 0;
      totalScore += marksAwarded;

      gradedAnswers[question.id] = {
        type: 'mcq',
        selectedOption: candidateAnswer.selectedOption,
        correctOption: question.correctOption,
        marksAwarded
      };
    } else if (question.type === 'coding') {
      const code = candidateAnswer.code || "";
      const language = candidateAnswer.language || "python";

      let testCasesPassed = 0;
      const totalTestCases = question.testCases.length;

      // Run code against ALL test cases (both Sample and Hidden)
      // Since executing multiple requests concurrently could time out Express and hit Judge0 rate limits, we run them sequentially
      for (const tc of question.testCases) {
        const languageId = LANGUAGE_MAPPING[language.toLowerCase()];
        if (!languageId) continue;
        
        try {
          const runRes = await executeCodeWithJudge0(languageId, code, tc.input);
          
          // Verify code compilation/execution was successful (Judge0 status ID 3 is "Accepted")
          if (runRes.status && runRes.status.id === 3) {
            const actualOutput = (runRes.stdout || "").trim();
            const expected = (tc.expectedOutput || "").trim();
            
            // Compare outputs (case and whitespace insensitive comparison for standard tests)
            if (actualOutput.replace(/\r\n/g, '\n') === expected.replace(/\r\n/g, '\n')) {
              testCasesPassed++;
            }
          }
        } catch (e) {
          // Ignore error and continue
        }
      }

      // Calculate partial marks based on percentage of test cases passed
      const scoreFraction = totalTestCases > 0 ? (testCasesPassed / totalTestCases) : 0;
      const marksAwarded = Math.round(scoreFraction * question.marks);
      totalScore += marksAwarded;

      gradedAnswers[question.id] = {
        type: 'coding',
        code,
        language,
        testCasesPassed,
        totalTestCases,
        marksAwarded
      };
    }
  }

  const newSubmission = {
    id: 's_' + Math.random().toString(36).substr(2, 9),
    testId,
    testTitle: test.title,
    candidateId: req.user.id,
    candidateName: req.user.username,
    submitTime: new Date().toISOString(),
    answers: gradedAnswers,
    score: totalScore,
    totalMarks: testTotalMarks,
    violations: violations || []
  };

  db.saveSubmission(newSubmission);
  res.json({
    id: newSubmission.id,
    score: totalScore,
    totalMarks: testTotalMarks,
    message: "Exam submitted successfully."
  });
});

// Get Submissions for a specific test (Educator Only)
app.get('/api/submissions/test/:testId', authenticateToken, requireEducator, (req, res) => {
  const submissions = db.getSubmissions();
  const testSubmissions = submissions.filter(s => s.testId === req.params.testId);
  res.json(testSubmissions);
});

// Get Candidate's own submissions
app.get('/api/submissions/candidate', authenticateToken, (req, res) => {
  if (req.user.role !== 'candidate') {
    return res.status(400).json({ error: "Only candidates have personal test history." });
  }
  const submissions = db.getSubmissions();
  const personalSubmissions = submissions.filter(s => s.candidateId === req.user.id);
  res.json(personalSubmissions);
});


// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
