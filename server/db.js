const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Ensure db directory and file exist
function initializeDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  if (!fs.existsSync(DB_PATH)) {
    const initialData = {
      users: [],
      tests: [],
      submissions: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2), 'utf8');
  }
}

// Read database
function readDb() {
  initializeDb();
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading database:", err);
    return { users: [], tests: [], submissions: [] };
  }
}

// Write database
function writeDb(data) {
  initializeDb();
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error("Error writing database:", err);
    return false;
  }
}

module.exports = {
  readDb,
  writeDb,
  // Helper functions
  getUsers: () => readDb().users,
  saveUser: (user) => {
    const db = readDb();
    db.users.push(user);
    writeDb(db);
    return user;
  },
  getTests: () => readDb().tests,
  saveTest: (test) => {
    const db = readDb();
    db.tests.push(test);
    writeDb(db);
    return test;
  },
  getSubmissions: () => readDb().submissions,
  saveSubmission: (submission) => {
    const db = readDb();
    db.submissions.push(submission);
    writeDb(db);
    return submission;
  }
};
